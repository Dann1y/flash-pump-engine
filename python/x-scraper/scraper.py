#!/usr/bin/env python3
"""
X.com Playwright scraper for trend detection.

Outputs JSON to stdout matching the ScraperOutput interface:
{
  "trends": [{
    "keyword": str,
    "tweet_count": int,
    "sample_tweets": [str],
    "image_urls": [str],
    "mention_count": int,
    "tweet_refs": [{"tweet_id": str, "screen_name": str}]
  }]
}

All logs go to stderr. Exit 0 on success, 1 on failure.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import signal
import sys
from pathlib import Path

from playwright.async_api import async_playwright, Page, BrowserContext

AUTH_DIR = Path(__file__).parent / ".auth"
STATE_FILE = AUTH_DIR / "state.json"

CRYPTO_QUERIES = [
    "memecoin",
    "pump.fun",
    "$SOL",
    "solana memecoin",
    "crypto meme",
    "degen",
]

MAX_TRENDS = 15
MAX_TWEETS_PER_QUERY = 20
OVERALL_TIMEOUT = 110  # seconds (parent has 120s)

TWEET_ID_RE = re.compile(r"^[0-9]{10,25}$")
SCREEN_NAME_RE = re.compile(r"^[A-Za-z0-9_]{1,15}$")
PERMALINK_RE = re.compile(r"/([A-Za-z0-9_]{1,15})/status/(\d{10,25})")


def log(msg: str) -> None:
    print(f"[x-scraper] {msg}", file=sys.stderr, flush=True)


def empty_output() -> dict:
    return {"trends": []}


class XScraper:
    def __init__(self, *, headful: bool = False) -> None:
        self.context: BrowserContext | None = None
        self.page: Page | None = None
        self._headful = headful

    async def launch(self) -> None:
        self._pw = await async_playwright().start()
        browser_args = ["--disable-blink-features=AutomationControlled"]

        AUTH_DIR.mkdir(parents=True, exist_ok=True)

        headless = not self._headful
        if self._headful:
            log("Launching in headful mode (manual intervention possible)")

        storage_state = str(STATE_FILE) if STATE_FILE.exists() else None
        self._browser = await self._pw.chromium.launch(headless=headless, args=browser_args)
        self.context = await self._browser.new_context(
            storage_state=storage_state,
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
        )
        self.page = await self.context.new_page()

    async def close(self) -> None:
        if self.context:
            try:
                await self.context.storage_state(path=str(STATE_FILE))
            except Exception as e:
                log(f"Warning: could not save auth state: {e}")
        if self._browser:
            await self._browser.close()
        if self._pw:
            await self._pw.stop()

    async def ensure_authenticated(self) -> bool:
        page = self.page
        try:
            await page.goto("https://x.com/home", wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(3000)

            # Check if we landed on the home timeline
            url = page.url
            if "/login" in url or "/i/flow/login" in url:
                log("Not authenticated, attempting login...")
                return await self._do_login()

            # Verify we see timeline content
            try:
                await page.wait_for_selector(
                    'article[data-testid="tweet"]', timeout=10000
                )
                log("Authenticated via saved state")
                return True
            except Exception:
                log("No timeline content found, attempting login...")
                return await self._do_login()
        except Exception as e:
            log(f"Auth check failed: {e}")
            return await self._do_login()

    async def _do_login(self) -> bool:
        page = self.page
        username = os.environ.get("X_USERNAME", "")
        password = os.environ.get("X_PASSWORD", "")

        if not username or not password:
            log("ERROR: X_USERNAME and X_PASSWORD env vars required for login")
            return False

        try:
            await page.goto(
                "https://x.com/i/flow/login",
                wait_until="domcontentloaded",
                timeout=30000,
            )
            await page.wait_for_timeout(2000)

            # Step 1: Enter username
            username_input = page.locator('input[autocomplete="username"]')
            await username_input.wait_for(timeout=10000)
            await username_input.fill(username)
            await page.keyboard.press("Enter")
            await page.wait_for_timeout(2000)

            # Step 2: Check for phone/email verification challenge
            phone_input = page.locator('input[data-testid="ocfEnterTextTextInput"]')
            if await phone_input.is_visible():
                phone_hint = os.environ.get("X_PHONE_HINT", "")
                if phone_hint:
                    log("Phone verification required, entering hint...")
                    await phone_input.fill(phone_hint)
                    await page.keyboard.press("Enter")
                    await page.wait_for_timeout(2000)
                else:
                    log("ERROR: Phone verification required but X_PHONE_HINT not set")
                    return False

            # Step 3: Enter password
            password_input = page.locator('input[name="password"]')
            await password_input.wait_for(timeout=10000)
            await password_input.fill(password)
            await page.keyboard.press("Enter")
            await page.wait_for_timeout(3000)

            # Verify login success
            url = page.url
            if "/home" in url:
                log("Login successful")
                await self.context.storage_state(path=str(STATE_FILE))
                return True

            # Wait a bit more and recheck
            await page.wait_for_timeout(3000)
            url = page.url
            if "/home" in url:
                log("Login successful (delayed)")
                await self.context.storage_state(path=str(STATE_FILE))
                return True

            log(f"Login may have failed, current URL: {url}")
            return False

        except Exception as e:
            log(f"Login error: {e}")
            return False

    async def scrape_explore_trends(self) -> list[dict]:
        page = self.page
        trends = []

        try:
            await page.goto(
                "https://x.com/explore/tabs/trending",
                wait_until="domcontentloaded",
                timeout=30000,
            )
            await page.wait_for_timeout(3000)

            trend_elements = await page.query_selector_all('[data-testid="trend"]')
            log(f"Found {len(trend_elements)} trend elements on Explore page")

            for el in trend_elements[:MAX_TRENDS]:
                try:
                    text_content = await el.inner_text()
                    lines = [
                        line.strip()
                        for line in text_content.split("\n")
                        if line.strip()
                    ]

                    # Extract keyword — typically the most prominent line
                    keyword = None
                    for line in lines:
                        if line.startswith("#") or (
                            not line.startswith("Trending")
                            and not re.match(r"^\d", line)
                            and "posts" not in line.lower()
                            and len(line) > 1
                        ):
                            keyword = line
                            break

                    if not keyword:
                        continue

                    # Try to extract post count
                    tweet_count = 0
                    for line in lines:
                        m = re.search(r"([\d,.]+[KMkm]?)\s*posts?", line, re.IGNORECASE)
                        if m:
                            tweet_count = _parse_count(m.group(1))
                            break

                    trends.append(
                        {
                            "keyword": keyword,
                            "tweet_count": max(tweet_count, 1),
                            "sample_tweets": [],
                            "image_urls": [],
                            "mention_count": max(tweet_count, 1),
                            "tweet_refs": [],
                        }
                    )
                except Exception as e:
                    log(f"Error parsing trend element: {e}")

        except Exception as e:
            log(f"Error scraping explore trends: {e}")

        return trends

    async def scrape_crypto_search(self, query: str) -> list[dict]:
        page = self.page
        results = []

        try:
            search_url = f"https://x.com/search?q={query}&src=typed_query&f=live"
            await page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(3000)

            # Scroll to load more tweets
            for _ in range(2):
                await page.evaluate("window.scrollBy(0, window.innerHeight)")
                await page.wait_for_timeout(1500)

            articles = await page.query_selector_all('article[data-testid="tweet"]')
            log(f"Query '{query}': found {len(articles)} tweets")

            for article in articles[:MAX_TWEETS_PER_QUERY]:
                parsed = await self._parse_tweet_article(article)
                if parsed:
                    results.append(parsed)

        except Exception as e:
            log(f"Error searching '{query}': {e}")

        return results

    async def _parse_tweet_article(self, article) -> dict | None:
        try:
            # Extract tweet text
            text_el = await article.query_selector('[data-testid="tweetText"]')
            text = (await text_el.inner_text()).strip() if text_el else ""

            if not text:
                return None

            # Extract tweet_ref from permalink (a:has(time))
            tweet_ref = None
            permalink_els = await article.query_selector_all("a:has(time)")
            for a_el in permalink_els:
                href = await a_el.get_attribute("href")
                if href:
                    m = PERMALINK_RE.search(href)
                    if m:
                        screen_name, tweet_id = m.group(1), m.group(2)
                        if TWEET_ID_RE.match(tweet_id) and SCREEN_NAME_RE.match(
                            screen_name
                        ):
                            tweet_ref = {
                                "tweet_id": tweet_id,
                                "screen_name": screen_name,
                            }
                            break

            # Extract image URLs
            image_urls = []
            img_els = await article.query_selector_all(
                'img[src*="pbs.twimg.com/media"]'
            )
            for img in img_els:
                src = await img.get_attribute("src")
                if src:
                    image_urls.append(src)

            # Extract hashtags as keywords
            hashtags = re.findall(r"#\w+", text)

            return {
                "text": text,
                "hashtags": hashtags,
                "image_urls": image_urls,
                "tweet_ref": tweet_ref,
            }
        except Exception as e:
            log(f"Error parsing tweet article: {e}")
            return None


def _parse_count(s: str) -> int:
    s = s.strip().replace(",", "")
    multiplier = 1
    if s.endswith(("K", "k")):
        multiplier = 1000
        s = s[:-1]
    elif s.endswith(("M", "m")):
        multiplier = 1_000_000
        s = s[:-1]
    try:
        return int(float(s) * multiplier)
    except ValueError:
        return 0


def merge_and_deduplicate(
    explore_trends: list[dict], search_results: dict[str, list[dict]]
) -> list[dict]:
    """Merge explore trends with search tweet results, grouped by keyword."""

    keyword_map: dict[str, dict] = {}

    # Add explore trends first
    for trend in explore_trends:
        kw = trend["keyword"].lower()
        keyword_map[kw] = trend

    # Group search tweets by hashtags or query keyword
    for query, tweets in search_results.items():
        for tweet in tweets:
            # Determine keywords for this tweet
            keys = [tag.lower() for tag in tweet.get("hashtags", [])]
            if not keys:
                keys = [query.lower()]

            for key in keys:
                if key not in keyword_map:
                    keyword_map[key] = {
                        "keyword": key if key.startswith("#") else f"#{key}" if not key.startswith("$") else key,
                        "tweet_count": 0,
                        "sample_tweets": [],
                        "image_urls": [],
                        "mention_count": 0,
                        "tweet_refs": [],
                    }

                entry = keyword_map[key]
                entry["tweet_count"] += 1
                entry["mention_count"] += 1

                text = tweet.get("text", "")
                if text and len(entry["sample_tweets"]) < 5:
                    entry["sample_tweets"].append(text)

                for url in tweet.get("image_urls", []):
                    if url not in entry["image_urls"] and len(entry["image_urls"]) < 5:
                        entry["image_urls"].append(url)

                ref = tweet.get("tweet_ref")
                if ref:
                    existing_ids = {r["tweet_id"] for r in entry["tweet_refs"]}
                    if ref["tweet_id"] not in existing_ids:
                        entry["tweet_refs"].append(ref)

    # Sort by mention_count descending
    merged = sorted(keyword_map.values(), key=lambda x: x["mention_count"], reverse=True)
    return merged


async def run(*, headful: bool = False) -> dict:
    scraper = XScraper(headful=headful)
    try:
        await scraper.launch()

        if not await scraper.ensure_authenticated():
            log("ERROR: Authentication failed")
            return empty_output()

        # 1. Scrape explore/trending
        log("Scraping explore trends...")
        explore_trends = await scraper.scrape_explore_trends()
        log(f"Got {len(explore_trends)} explore trends")

        # 2. Scrape crypto search queries
        search_results: dict[str, list[dict]] = {}
        for query in CRYPTO_QUERIES:
            log(f"Searching: {query}")
            results = await scraper.scrape_crypto_search(query)
            search_results[query] = results
            # Brief pause between searches to avoid rate limiting
            await asyncio.sleep(1)

        # 3. Merge and deduplicate
        merged = merge_and_deduplicate(explore_trends, search_results)
        log(f"Merged into {len(merged)} unique trends")

        return {"trends": merged}

    except Exception as e:
        log(f"Scraper error: {e}")
        return empty_output()

    finally:
        await scraper.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="X.com trend scraper")
    parser.add_argument(
        "--json", action="store_true", help="Output JSON to stdout"
    )
    parser.add_argument(
        "--headful", action="store_true",
        help="Launch Chromium with visible UI (for manual login / CAPTCHA)",
    )
    args = parser.parse_args()

    if not args.json:
        print("Usage: scraper.py --json [--headful]", file=sys.stderr)
        sys.exit(1)

    # Self-timeout: 110s (parent has 120s) — skip in headful mode to allow manual intervention
    if not args.headful:
        def timeout_handler(signum, frame):
            log("TIMEOUT: self-terminating at 110s")
            print(json.dumps(empty_output()))
            sys.exit(1)

        signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(OVERALL_TIMEOUT)

    try:
        result = asyncio.run(run(headful=args.headful))
        print(json.dumps(result))
        sys.exit(0)
    except Exception as e:
        log(f"Fatal error: {e}")
        print(json.dumps(empty_output()))
        sys.exit(1)


if __name__ == "__main__":
    main()
