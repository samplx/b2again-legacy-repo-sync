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
