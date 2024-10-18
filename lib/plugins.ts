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
    versions?: Record<string, string>;
    business_model?: boolean | string;
    repository_url?: string;
    commercial_support_url?: string;
    donate_link?: string;
    banners?: Array<unknown> | BannersInfo;
    preview_link?: string;
}

/**
 * Redact content from plugin information.
 * @param input source plugin information.
 * @returns plugin information with selected fields redacted/zero'd.
 */
export function sanitizePluginInfo(input: PluginInfo): PluginInfo {
    const result = { ... input};
    result.rating = 0;
    result.ratings = {'1': 0, '2': 0, '3': 0, '4': 0, '5': 0};
    result.num_ratings = 0;
    result.support_threads = 0;
    result.support_threads_resolved = 0;
    result.active_installs = 0;
    if (typeof result.sections?.reviews === 'string') {
        result.sections.reviews = undefined;
    }
    return result;
}
