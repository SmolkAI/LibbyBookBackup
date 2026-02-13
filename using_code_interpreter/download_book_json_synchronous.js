const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function loadConfig() {
    const configPath = path.join(PROJECT_ROOT, 'config.json');
    let config = {};
    if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    return {
        chromeProfilePath: config.chromeProfilePath || process.env.LIBBY_CHROME_PROFILE || '',
        dataDir: config.dataDir || process.env.LIBBY_DATA_DIR || PROJECT_ROOT,
        booksDir: config.booksDir || 'books',
        timelineFile: config.timelineFile || 'libbytimeline-activities.json',
    };
}

const CONFIG = loadConfig();
if (!CONFIG.chromeProfilePath) {
    console.error('Error: Chrome profile path not configured.');
    console.error('Set LIBBY_CHROME_PROFILE env var or create config.json (see config.example.json)');
    process.exit(1);
}

// Load the JSON data file
const timelineJson = require(path.join(PROJECT_ROOT, CONFIG.timelineFile));

// Load the list of book IDs that have already been downloaded
let downloadedBooksFile = path.join(PROJECT_ROOT, 'downloaded_books.txt');
let downloadedBooksList = readBookIdsFromFile(downloadedBooksFile);

// Function to read book IDs from a file
function readBookIdsFromFile(file) {
    try {
        // if the file is over 8 hours old, delete it
        if (fs.existsSync(file)) {
            const stats = fs.statSync(file);
            const lastModified = new Date(stats.mtime);
            const now = new Date();
            const hours = Math.abs(now - lastModified) / 36e5;
            if (hours > 8) {
                fs.unlinkSync(file);
            }
        }

        // if the file doesn't exist, create it
        if (!fs.existsSync(file)) {
            fs.writeFileSync(file, '');
        }

        // read the file
        const data = fs.readFileSync(file, 'utf8');
        const bookIds = data.trim().split('\n');
        return bookIds;
    } catch (err) {
        console.error('Error reading book IDs:', err);
        return [];
    }
}

// Function to save book IDs to a file (synchronous version)
function saveBookIdsToFile(file, bookIds) {
    try {
        const data = bookIds.join('\n');
        fs.writeFileSync(file, data);
    } catch (err) {
        console.error('Error saving book IDs:', err);
    }
}

// Function to save book IDs to a file (Async version)
/*
const { promisify } = require('util');
const writeFileAsync = promisify(fs.writeFile);

let writeQueue = Promise.resolve();

function saveBookIdsToFile(file, bookIds) {
    writeQueue = writeQueue.then(() => {
        return writeFileAsync(file, bookIds.join('\n') + '\n');
    }).then(() => {
        console.log('Book IDs saved to', file);
    }).catch((err) => {
        console.error('Error saving book IDs:', err);
    });
}
*/

/**
 * Save a JSON file to disk
 * 
 * @param {string|object} data - The JSON data to save. If a string, it is assumed to be a URL to fetch. If an object, it is assumed to be the JSON data itself.
 * @param {string} folder - The folder to save the file in. Defaults to "books".
 * @returns {Promise<void>}
 * 
 * @example
 * // Save a JSON file from a URL
 * await saveJson('https://cdn.libbyapp.com/reading-journey/reading-journey-0001.json');
 */
const logEachBook = true; // set to true to log each book as it is saved
async function saveJson(data, folder = "books") {
    if (!data) {
        console.error("No data to save");
        return;
    }

    // if data is a URL, fetch it
    else if (typeof data === "string") {
        const response = await fetch(data);
        data = await response.json();
    }

    // if data is a Reading Journey json file, read it
    else if (data instanceof File) {
        data = await data.text();
        data = JSON.parse(data);
    }

    const timestamp = Math.max(...data.circulation.map(item => item.timestamp));
    const date1 = format(new Date(timestamp), 'yyyy-MM-dd HH-mm');
    const current_date = format(new Date(), 'yyyy-MM-dd HH-mm');
    const title = data.readingJourney.title.text.replace(/[/\\?%*:|"<>]/g, ''); // remove illegal characters from the title so it can be used as a filename
    const author = data.readingJourney.author;
    const bookFormat = data.readingJourney.cover.format;

    const filename = `Book ${date1} ${title} by ${author} ${bookFormat} notes (downloaded ${current_date}).json`;
    const filePath = path.join(PROJECT_ROOT, folder, filename);

    const fullFolder = path.join(PROJECT_ROOT, folder);
    if (!fs.existsSync(fullFolder)) {
        fs.mkdirSync(fullFolder, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    // save the book title ID to the downloadedBooks text list and then save the list to the downloaded_books.txt file
    downloadedBooksList.push(data.readingJourney.title.titleId);
    saveBookIdsToFile(downloadedBooksFile, downloadedBooksList); // I wish there were a way to save to disk less often

    if (logEachBook) {
        console.log(`Saved ${title}`);
    }
}
// rename this file to ..._async.js

// Start Puppeteer
(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        userDataDir: CONFIG.chromeProfilePath,
        args: ['--disable-blink-features=AutomationControlled'] // hide the fact that this is an automated browser
    });


    const page = await browser.newPage();

    // Set the request authorization headers
    await page.setExtraHTTPHeaders({
        // Given that I have the authorization headers, I don't need to log in manually
        'Connection': 'keep-alive',
        // 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
        // 'x-client-id': 'dewey',
        'DNT': '1',
    });

    // Visit each book's reading journey URL and export the data
    for (let book of timelineJson.timeline) {
        // Skip books that have already been downloaded
        // TODO: there should be a better way to determine whether the downloaded version is the same as the one in the timeline
        if (downloadedBooksList.includes(book.title.titleId)) {
            console.log(`Skipping ${book.title.text} (${book.title.titleId}) because it has already been downloaded`);
            continue;
        }

        if (!book.reading_journey_url) {
            book.reading_journey_url = `${book.library.url}/similar-${book.title.titleId}/page-1/${book.title.titleId}/journey/${book.title.titleId}`;
        }
        const journeyUrl = book.reading_journey_url;

        if (journeyUrl.includes('undefined')) {
            console.error(`In the book ${book.title.text} (${book.title.titleId}), the journeyUrl has undefined in it: ${journeyUrl}`);
            continue;
        }

        await page.goto(journeyUrl, { waitUntil: 'networkidle0' }); // Crashes if journeyUrl is not defined

        // TODO: figure out why this errors out when not doing it manually and slowly
        for (let selector of ['#shelf-actions-pill-0001 > span', 'a:nth-of-type(2) > span', 'a:nth-of-type(3) > span:nth-of-type(1)']) {
            try {
                await page.waitForSelector(selector);
                await page.hover(selector);
                await page.evaluate((selector) => document.querySelector(selector).click(), selector);
                // await page.click(selector);
                // await page.waitForNavigation({waitUntil: 'networkidle2'}); // Wait for the button to be clicked
            } catch (error) {
                if (error.message == "Node is either not visible or not an HTMLElement") {
                    // If this happened, then manually just wait a few seconds and click the selector
                    await page.waitForTimeout(5000);
                    await page.evaluate((selector) => document.querySelector(selector).click(), selector);
                } else {
                    console.error("An error occurred: ", error);
                }
            }
        }

        // Wait for the download to complete
        await page.waitForNavigation({ waitUntil: 'networkidle0' });
        const url = await page.evaluate(() => document.URL);

        let readingJourneyJsonUrl;  // URL of the JSON file containing the circulation, and bookmarks and notes

        if (url.includes('libbyjourney')) {
            readingJourneyJsonUrl = url;
        }
        else {
            console.log("Book not downloaded: " + book.title)
            console.log('Not a journey JSON URL: ' + url);
        }


        // Add the download URL to the JSON data
        // this doesn't work because readingJourneyJsonUrl is not defined when the JSON is opened
        book["download_url"] = readingJourneyJsonUrl;

        // Save JSON data
        await saveJson(readingJourneyJsonUrl);

    }

    await browser.close();
})();
