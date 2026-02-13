const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const MAX_CONCURRENT = 5;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

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

// Progress tracking
const PROGRESS_FILE = path.join(PROJECT_ROOT, 'downloaded_books.txt');

function loadDownloadedIds() {
    try {
        if (!fs.existsSync(PROGRESS_FILE)) return new Set();
        const data = fs.readFileSync(PROGRESS_FILE, 'utf8').trim();
        return new Set(data ? data.split('\n') : []);
    } catch {
        return new Set();
    }
}

function saveDownloadedId(titleId) {
    fs.appendFileSync(PROGRESS_FILE, titleId + '\n');
}

function saveJson(data) {
    const booksDir = path.join(PROJECT_ROOT, CONFIG.booksDir);
    if (!fs.existsSync(booksDir)) fs.mkdirSync(booksDir, { recursive: true });

    const timestamp = Math.max(...data.circulation.map(item => item.timestamp));
    const date1 = format(new Date(timestamp), 'yyyy-MM-dd HH-mm');
    const current_date = format(new Date(), 'yyyy-MM-dd HH-mm');
    const title = data.readingJourney.title.text.replace(/[/\\?%*:|"<>]/g, '');
    const author = data.readingJourney.author;
    const bookFormat = data.readingJourney.cover.format;

    const filename = `Book ${date1} ${title} by ${author} ${bookFormat} notes (downloaded ${current_date}).json`;
    const filePath = path.join(booksDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return filename;
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadBook(browser, book, attempt = 1) {
    const page = await browser.newPage();
    try {
        await page.setExtraHTTPHeaders({ 'Connection': 'keep-alive', 'DNT': '1' });

        if (!book.reading_journey_url) {
            book.reading_journey_url = `${book.library.url}/similar-${book.title.titleId}/page-1/${book.title.titleId}/journey/${book.title.titleId}`;
        }
        const journeyUrl = book.reading_journey_url;

        if (journeyUrl.includes('undefined')) {
            console.error(`  SKIP ${book.title.text}: journey URL contains undefined`);
            return false;
        }

        await page.goto(journeyUrl, { waitUntil: 'networkidle0', timeout: 30000 });

        // Click through the export flow: Actions -> Export -> JSON
        for (const selector of [
            '#shelf-actions-pill-0001 > span',
            'a:nth-of-type(2) > span',
            'a:nth-of-type(3) > span:nth-of-type(1)',
        ]) {
            try {
                await page.waitForSelector(selector, { timeout: 10000 });
                await page.hover(selector);
                await page.evaluate((sel) => document.querySelector(sel).click(), selector);
                await sleep(500);
            } catch (err) {
                // Retry click after delay
                await sleep(3000);
                try {
                    await page.evaluate((sel) => document.querySelector(sel).click(), selector);
                } catch {
                    throw new Error(`Failed to click ${selector}: ${err.message}`);
                }
            }
        }

        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 });
        const url = await page.evaluate(() => document.URL);

        if (!url.includes('libbyjourney')) {
            throw new Error(`Not a journey URL: ${url}`);
        }

        // Fetch the JSON data
        const response = await page.evaluate(async (jsonUrl) => {
            const resp = await fetch(jsonUrl);
            return resp.json();
        }, url);

        const filename = saveJson(response);
        saveDownloadedId(book.title.titleId);
        console.log(`  OK ${book.title.text}`);
        return true;
    } catch (err) {
        if (attempt < MAX_RETRIES) {
            console.log(`  RETRY ${book.title.text} (attempt ${attempt + 1}/${MAX_RETRIES}): ${err.message}`);
            await sleep(RETRY_DELAY_MS * attempt);
            await page.close().catch(() => {});
            return downloadBook(browser, book, attempt + 1);
        }
        console.error(`  FAIL ${book.title.text}: ${err.message}`);
        return false;
    } finally {
        await page.close().catch(() => {});
    }
}

// Simple concurrency limiter
function pLimit(concurrency) {
    let active = 0;
    const queue = [];
    function next() {
        if (active >= concurrency || queue.length === 0) return;
        active++;
        const { fn, resolve, reject } = queue.shift();
        fn().then(resolve, reject).finally(() => { active--; next(); });
    }
    return function limit(fn) {
        return new Promise((resolve, reject) => {
            queue.push({ fn, resolve, reject });
            next();
        });
    };
}

(async () => {
    const timelineJson = require(path.join(PROJECT_ROOT, CONFIG.timelineFile));
    const downloadedIds = loadDownloadedIds();
    const books = timelineJson.timeline.filter(b => !downloadedIds.has(b.title.titleId));

    console.log(`Total books in timeline: ${timelineJson.timeline.length}`);
    console.log(`Already downloaded: ${downloadedIds.size}`);
    console.log(`To download: ${books.length}`);

    if (books.length === 0) {
        console.log('All books already downloaded.');
        process.exit(0);
    }

    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        userDataDir: CONFIG.chromeProfilePath,
        args: ['--disable-blink-features=AutomationControlled'],
    });

    const limit = pLimit(MAX_CONCURRENT);
    let done = 0;
    let failed = 0;

    const results = await Promise.all(
        books.map(book => limit(async () => {
            const ok = await downloadBook(browser, book);
            done++;
            if (!ok) failed++;
            process.stdout.write(`\r  Progress: ${done}/${books.length} (${failed} failed)`);
            return ok;
        }))
    );

    console.log(`\nDone. Downloaded ${results.filter(Boolean).length}/${books.length} books.`);
    await browser.close();
})();
