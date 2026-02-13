import json
import os
import sys
from pathlib import Path

import requests
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import TimeoutException

PROJECT_ROOT = Path(__file__).resolve().parent.parent

def load_config():
    """Load config from config.json, falling back to env vars."""
    config_path = PROJECT_ROOT / "config.json"
    config = {}
    if config_path.exists():
        with open(config_path) as f:
            config = json.load(f)
    return {
        "chromeProfilePath": config.get("chromeProfilePath") or os.environ.get("LIBBY_CHROME_PROFILE", ""),
        "dataDir": config.get("dataDir") or os.environ.get("LIBBY_DATA_DIR", str(PROJECT_ROOT)),
        "exportLogFile": config.get("exportLogFile", "export_log.txt"),
        "timelineFile": config.get("timelineFile", "libbytimeline-activities.json"),
    }

def log_to_file(url, config):
    log_file_path = Path(config["dataDir"]) / config["exportLogFile"]
    with open(log_file_path, "a") as log_file:
        log_file.write(f"Exported URL: {url}\n")

def export_timeline():
    config = load_config()
    if not config["chromeProfilePath"]:
        print("Error: Chrome profile path not configured.", file=sys.stderr)
        print("Set LIBBY_CHROME_PROFILE env var or create config.json (see config.example.json)", file=sys.stderr)
        sys.exit(1)

    # Initialize WebDriver
    chrome_options = Options()
    user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    chrome_options.arguments.extend([f"user-agent={user_agent}", f"user-data-dir={config['chromeProfilePath']}"])
    driver = webdriver.Chrome(options=chrome_options)

    # Set viewport size to the size I had when I first wrote this script
    # driver.set_window_size(543, 978)

    # Navigate to website
    driver.get("https://libbyapp.com/timeline/activities")

    # Wait for the Actions button
    wait = WebDriverWait(driver, 5)  # 5 seconds timeout
    actions_button = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, '#shelf-actions-pill-0001 > span')))
    actions_button.click()
    
    # Sync Timeline
    sync_timeline_button = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, 'div.arena-overlay a:nth-of-type(1)')))
    sync_timeline_button.click()

    driver.get("https://libbyapp.com/shelf/timeline/all,loans,all")

    # Wait for the Actions button
    wait = WebDriverWait(driver, 5)  # 5 seconds timeout
    actions_button_selectors = [
        '#shelf-actions-pill-0001 > span',
        '#shelf-actions-pill-0002 > span',
        '#shelf-actions-pill-0003 > span'
    ]

    for selector in actions_button_selectors:
        try:
            actions_button = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, selector)))
            break
        except TimeoutException:
            continue
    else:
        raise TimeoutException("Actions button not found.")
    actions_button.click()
    # Click Export Timeline
    export_timeline_button = wait.until(EC.element_to_be_clickable((By.XPATH, "//span[text()='Export Timeline']")))
    export_timeline_button.click()

    # Click JSON Data export button
    data_button = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, 'a:nth-of-type(3) > span:nth-of-type(1)')))
    data_button.click()

    # Save the webpage as a JSON file
    wait.until(lambda d: d.current_url.find("data") == 27)
    log_to_file(driver.current_url, config)
    if driver.current_url.find("data") == 27:
        current_url = driver.current_url
    else:
        raise Exception("The exported timeline was not loaded. Current page: " + driver.current_url)

    # Fetch URL content
    response = requests.get(current_url)
    json_data = response.json()
    save_path = Path(config["dataDir"]) / config["timelineFile"]

    with open(save_path, "w") as f:
        json.dump(json_data, f, indent=2)

    # Close the browser
    driver.quit()

    return save_path

if __name__ == "__main__":
    export_timeline()