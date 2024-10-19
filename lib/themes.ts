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
    profile?: string;
    avatar?: string;
    display_name?: string;
    author?: string;
    author_url?: string;
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

function isWordpressOrg(url: string): boolean {
    return url.startsWith('https://wordpress.org/');
}

function getReviewUrl(supportBaseUrl: string, slug: string): string {
    return new URL(`/reviews/themes/legacy/${slug}/`, supportBaseUrl).toString();
}

function getHomepageUlr(supportBaseUrl: string, slug: string): string {
    return new URL(`/homepages/themes/legacy/${slug}/`, supportBaseUrl).toString();
}

export function migrateThemeInfo(downloadsBaseUrl: string, supportBaseUrl: string, themeDir: string, input: ThemeInfo): ThemeInfo {

    const kleen = { ...input };
    if ((typeof kleen.author === 'string') && (kleen.author.indexOf('@') < 0)) {
        kleen.author = `${kleen.author}@wordpress.org`;
    } else if ((typeof kleen.author === 'object') &&
               (kleen.author.user_nicename && (kleen.author.user_nicename.indexOf('@') < 0))) {
        kleen.author.user_nicename = `${kleen.author.user_nicename}@wordpress.org`;
    }
    kleen.preview_url = new URL(`${themeDir}/preview/index.html`, downloadsBaseUrl).toString();
    if (kleen.screenshot_url) {
        const screenshot = getBasename(kleen.screenshot_url);
        kleen.screenshot_url = new URL(`${themeDir}/screenshots/${screenshot}`, downloadsBaseUrl).toString();
    }
    if (kleen.download_link) {
        const download = getBasename(kleen.download_link);
        kleen.download_link = new URL(`${themeDir}/${download}`, downloadsBaseUrl).toString();
    }
    if (kleen.reviews_url && kleen.slug && isWordpressOrg(kleen.reviews_url)) {
        kleen.reviews_url = getReviewUrl(supportBaseUrl, kleen.slug);
    }
    if (kleen.homepage && kleen.slug && isWordpressOrg(kleen.homepage)) {
        kleen.homepage = getHomepageUlr(supportBaseUrl, kleen.slug);
    }
    if (kleen.versions) {
        // kleen is a shallow copy, deepen it before we mutate it
        kleen.versions = { ...kleen.versions };
        for (const version in kleen.versions) {
            const basename = getBasename(kleen.versions[version]);
            kleen.versions[version] = new URL(`${themeDir}/${basename}`, downloadsBaseUrl).toString();
        }
    }
    kleen.rating = 0;
    kleen.ratings = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    kleen.num_ratings = 0;
    kleen.active_installs = 0;
    kleen.downloaded = 0;
    return kleen;
}
