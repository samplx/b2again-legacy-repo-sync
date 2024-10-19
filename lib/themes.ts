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


export interface ThemeAuthor {
    user_nicename?: string;
    profile?: boolean | string;
    avatar?: boolean | string;
    display_name?: string;
    author?: boolean | string;
    author_url?: boolean | string;
}

export interface ThemeInfo {
    name?: string;
    slug?: string;
    version?: string;
    preview_url?: string;
    author?: string | ThemeAuthor;
    screenshot_url?: string;
    ratings?: Record<string, number>;
    rating?: number;
    num_ratings?: number;
    reviews_url?: string;
    downloaded?: number;
    active_installs?: number;
    last_updated?: string;
    last_updated_time?: string;
    creation_time?: string;
    homepage?: string;
    sections?: Record<string, string>;
    download_link?: string;
    tags?: Record<string, string>;
    versions?: Record<string, string>;
    requires?: boolean | string;
    requires_php?: boolean | string;
    is_commercial?: boolean;
    external_support_url?: boolean | string;
    is_community?: boolean;
    external_repository_url?: string;
}

function getBasename(url: string): string {
    return url.substring(url.lastIndexOf('/')+1);
}

function getHomepageUrl(supportBaseUrl: string, slug: string): string {
    return new URL(`/homepages/themes/legacy/${slug}/`, supportBaseUrl).toString();
}

function getReviewUrl(supportBaseUrl: string, slug: string): string {
    return new URL(`/reviews/themes/legacy/${slug}/`, supportBaseUrl).toString();
}

function getScreenshotUrl(downloadsBaseUrl: string, themeLiveDir: string, url: string): string {
    const screenshot = getBasename(url);
    return new URL(`${themeLiveDir}/screenshots/${screenshot}`, downloadsBaseUrl).toString();
}

function getZipUrl(downloadsBaseUrl: string, themeReadOnlyDir: string, existing: string): string {
    const filename = getBasename(existing);
    return new URL(`${themeReadOnlyDir}/${filename}`, downloadsBaseUrl).toString();

}

function isWordpressOrg(url: string): boolean {
    return url.startsWith('https://wordpress.org/');
}

export function migrateThemeInfo(downloadsBaseUrl: string,
                                 supportBaseUrl: string,
                                 themeLiveDir: string,
                                 themeReadOnlyDir: string,
                                 input: ThemeInfo): ThemeInfo {

    const kleen = { ...input };
    if ((typeof kleen.author === 'string') && (kleen.author.indexOf('@') < 0)) {
        kleen.author = `${kleen.author}@wordpress.org`;
    } else if ((typeof kleen.author === 'object') &&
               (kleen.author.user_nicename && (kleen.author.user_nicename.indexOf('@') < 0))) {
        kleen.author.user_nicename = `${kleen.author.user_nicename}@wordpress.org`;
    }
    kleen.preview_url = new URL(`${themeLiveDir}/preview/index.html`, downloadsBaseUrl).toString();
    if (kleen.screenshot_url) {
        kleen.screenshot_url = getScreenshotUrl(downloadsBaseUrl, themeLiveDir, kleen.screenshot_url);
    }
    if (kleen.download_link) {
        kleen.download_link = getZipUrl(downloadsBaseUrl, themeReadOnlyDir, kleen.download_link);
    }
    if (kleen.reviews_url && kleen.slug && isWordpressOrg(kleen.reviews_url)) {
        kleen.reviews_url = getReviewUrl(supportBaseUrl, kleen.slug);
    }
    if (kleen.homepage && kleen.slug && isWordpressOrg(kleen.homepage)) {
        kleen.homepage = getHomepageUrl(supportBaseUrl, kleen.slug);
    }
    if (kleen.versions) {
        // kleen is a shallow copy, deepen it before we mutate it
        kleen.versions = { ...kleen.versions };
        for (const version in kleen.versions) {
            kleen.versions[version] = getZipUrl(downloadsBaseUrl, themeReadOnlyDir, kleen.versions[version]);
        }
    }
    kleen.rating = 0;
    kleen.ratings = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    kleen.num_ratings = 0;
    kleen.active_installs = 0;
    kleen.downloaded = 0;
    return kleen;
}
