/*
 *  Copyright 2024 James Burlingame
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */
'use strict';

import { escape } from "jsr:@std/regexp";

/**
 * Plugin contributor information.
 */
export interface ContributorInfo {
    profile?: string;
    avatar?: string;
    display_name?: string;
}

/**
 * Plugin screenshot information.
 */
export interface ScreenshotInfo {
    src?: string;
    caption?: string;
}

/**
 * Plugin banner information.
 * Since this is traditionally the result of PHP -> JSON translation,
 * a normally 'null' value comes accross as a `false` value.
 */
export interface BannersInfo {
    low?: boolean | string;
    high?: boolean | string;
}

/**
 *
 */
export interface PluginInfo {
    name?: string;
    slug?: string;
    version?: string;
    author?: string;
    author_profile?: string;
    contributors?: Record<string, ContributorInfo>;
    requires?: string;
    tested?: string;
    requires_php?: boolean | string;
    requires_plugins?: Array<string>;
    rating?: number;
    ratings?: Record<string, number>;
    num_ratings?: number;
    support_url?: string;
    support_threads?: number;
    support_threads_resolved?: number;
    active_installs?: number;
    last_updated?: string;
    added?: string;
    homepage?: string;
    sections?: Record<string, string | undefined>;
    download_link?: string;
    upgrade_notice?: Record<string, string>;
    screenshots?: Record<string, ScreenshotInfo>;
    tags?: Record<string, string>;
    versions?: Record<string, undefined | string>;
    business_model?: boolean | string;
    repository_url?: string;
    commercial_support_url?: string;
    donate_link?: string;
    banners?: Array<unknown> | BannersInfo;
    preview_link?: string;
}

function getBannerUrl(downloadsBaseUrl: string, split: string, url: string): string {
    const screenshot = getBasename(url);
    return new URL(`/plugins/live/legacy/${split}/banners/${screenshot}`, downloadsBaseUrl).toString();
}

function getBasename(url: string): string {
    return url.substring(url.lastIndexOf('/')+1);
}

function getHomepageUrl(supportBaseUrl: string, slug: string): string {
    return new URL(`/homepages/plugins/legacy/${slug}/`, supportBaseUrl).toString();
}

function getPreviewUrl(downloadsBaseUrl: string, split: string): string {
    return new URL(`/plugins/live/legacy/${split}/preview/index.html`, downloadsBaseUrl).toString();
}

function getScreenshotUrl(downloadsBaseUrl: string, split: string, url: string): string {
    const screenshot = getBasename(url);
    const kleen =  new URL(`/plugins/live/legacy/${split}/screenshots/${screenshot}`, downloadsBaseUrl);
    kleen.search = '';
    return kleen.toString();
}

function getSupportUrl(supportBaseUrl: string, slug: string): string {
    return new URL(`/support/plugins/legacy/${slug}/`, supportBaseUrl).toString();
}

function getZipUrl(downloadsBaseUrl: string, split: string, existing: string): string {
    const filename = getBasename(existing);
    return new URL(`/plugins/read-only/legacy/${split}/${filename}`, downloadsBaseUrl).toString();

}

function isWordpressOrg(url: string): boolean {
    return url.startsWith('https://wordpress.org/') || url.startsWith('http://wordpress.org/');
}


/**
 * Redact content from plugin information.
 * @param input source plugin information.
 * @returns plugin information with selected fields redacted/zero'd.
 */
export function migratePluginInfo(downloadsBaseUrl: string,
    supportBaseUrl: string,
    split: string,
    input: PluginInfo): PluginInfo {
    const kleen = { ... input};
    const screenshotMap: Record<string, string> = {};

    kleen.active_installs = 0;
    if (kleen.banners && !Array.isArray(kleen.banners)) {
        kleen.banners = { ...kleen.banners };
        if (typeof kleen.banners?.high === 'string') {
            kleen.banners.high = getBannerUrl(downloadsBaseUrl, split, kleen.banners.high);
        }
        if (typeof kleen.banners?.low === 'string') {
            kleen.banners.low = getBannerUrl(downloadsBaseUrl, split, kleen.banners.low);
        }
    }
    if (kleen.download_link) {
        kleen.download_link = getZipUrl(downloadsBaseUrl, split, kleen.download_link);
    }
    if (kleen.homepage && kleen.slug && isWordpressOrg(kleen.homepage)) {
        kleen.homepage = getHomepageUrl(supportBaseUrl, kleen.slug);
    }
    kleen.num_ratings = 0;
    if (kleen.preview_link) {
        kleen.preview_link = getPreviewUrl(downloadsBaseUrl, split);
    }
    kleen.rating = 0;
    kleen.ratings = {'1': 0, '2': 0, '3': 0, '4': 0, '5': 0};
    if (kleen.screenshots) {
        // kleen is a shallow copy, deepen it before we mutate it
        kleen.screenshots = { ...kleen.screenshots };
        for (const key in kleen.screenshots) {
            if (kleen.screenshots[key].src) {
                const updated = getScreenshotUrl(downloadsBaseUrl, split, kleen.screenshots[key].src ?? '--should-not-happen-famous-last-words--');
                screenshotMap[kleen.screenshots[key].src] = updated;
                kleen.screenshots[key].src = updated;
            }
        }
    }
    if (kleen.sections) {
        kleen.sections = { ...kleen.sections };
        if (typeof kleen.sections?.reviews === 'string') {
            kleen.sections.reviews = undefined;
        }
        if (typeof kleen.sections?.screenshots === 'string') {
            let contents = kleen.sections.screenshots;
            for (const old in screenshotMap) {
                const search = new RegExp(escape(old), 'g');
                const replacement = screenshotMap[old];
                contents = contents.replaceAll(search, replacement);
            }
            kleen.sections.screenshots = contents;
        }
    }
    kleen.support_threads = 0;
    kleen.support_threads_resolved = 0;
    if (kleen.support_url && kleen.slug && isWordpressOrg(kleen.support_url)) {
        kleen.support_url = getSupportUrl(supportBaseUrl, kleen.slug);
    }
    if (kleen.versions) {
        // kleen is a shallow copy, deepen it before we mutate it
        kleen.versions = { ...kleen.versions };
        for (const version in kleen.versions) {
            if (version === 'trunk') {
                kleen.versions['trunk'] = undefined;
            } else if (kleen.versions[version]) {
                kleen.versions[version] = getZipUrl(downloadsBaseUrl, split, kleen.versions[version]);
            }
        }
    }
    return kleen;
}
