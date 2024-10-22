# b2again-legacy-repo-sync

A set of [Deno](https://docs.deno.com/)
[Typescript](https://www.typescriptlang.org/docs/handbook/intro.html) programs that are
designed to create an unofficial mirror of a legacy CMS project's
public assets.

## Archive sizes

The tools support two modes. A **partial** archive is the default. This is just an archive of
the required meta data and the read-only zip files. Only the current version of
each plugin or theme is downloaded.
A **full** archive also includes any
screenshot or banner files, or any preview pages, and **all** versions of **every listed** plugin or theme.

### Plugins

The preliminary numbers are ~30 GB for partial plugin download. Full download is in progress.

### Themes

The preliminary numbers are ~22 GB for partial themes download and ~306 GB for a full download.
The list of themes is taken from the subversion repository HTML page at `https://themes.svn.wordpress.org/`.

```
$ du -hs themes/*
5.0G	themes/live
351M	themes/meta
301G	themes/read-only
100M	themes/themes-status.json
```

## pluperfect.ts

A tool to mirror wordpress.org plugins and associated files.

## themattic.ts

A tool to mirror wordpress.org themes and associated files.

## midst.ts

A tool to mirror wordpress.org core releases and associated files.

## Limitations

The current implementation is single-threaded.
Slow and steady doesn't put an undue burden on up-stream resources. Once
the archive is downloaded, updates are minimal and not time critical.
It is hard to justify a need for up-to-the-minute mirroring, when a
once a day update schedule may meet most needs.
Again, it is open source, so someone can multi-thread it if they want.

The current implementation is also has a considerable memory footprint.
It requires a 8GB Droplet to download the plugins. A 2GB Droplet was able
to download the themes. Future versions may address this.

## Lists

The tools will soon support a list of items to be downloaded. The items, plugins or themes, are
identified by their **slug**. For example, everyone's favorite plugin to delete has
the slug `hello-dolly`.

The initial tools only supported gathering the list from the subversion page, so that list is
called `subversion`. This page is
problematic since around half of the entries are not valid. This leads to a whole lot of
**404**'s as we attempt to get the detailed information about a plugin or theme that does
not exist. It is however, the largest list, if you don't want to miss anything.

As an alternative, there are two sources. First, a list of slugs can be read from a file.
This would allow for someone to easily create a mirror of the plugins and themes that they
find *interesting*. So the list is named `interesting`.

There is also the existing wordpress API at `api.wordpress.org`. This has REST API's that
provide information about groups of plugins and themes. They have a `browse` parameter,
each setting of which leads to another supported list type. The default (not provided)
value results in the `defaults` list. Then the `featured`, `new`, `popular` and `updated`
values for `browse` correspond to the same name in a list.

At least with themes, there is data that comes from `api.wordpress.org` when a list of
themes is requested that is not included when a single theme's information is requested.
This means that the `themes.json` file that is generated includes information from
the list of themes from the API, information about a specific theme from `legacy-themes.json`,
in addition to the localization changes.

## Directory structure

### `/live`

Contains mutable files associated with the "current" version.
Under this directory there are screenshots, banners (plugins) and sample pages (themes).
Only exists in **full** archive.

A future version will support the use of cache busting names for live files.

### `/meta`

Contains mutable JSON file describing the archive. The contents of the JSON is
can be used to serve the WP compatible API.

### `/read-only`

Contains immutable **zip** files. These files are marked read-only
in the archive. They are assumed to be immutable, at least for performance
purposes. Immutable for businesses reasons is beyond the scope of these tools.

### `legacy` directory

In order to distinguish content that came from upstream sources, and any future
local development, a `legacy` directory level is added.

### (Two-letter) Prefix Directory

The existing legacy layout favors an **all-in-one** approach. It has more
than one directory with over 100 000 entries. As a premature optimization,
I will not replicate this.
I have not tested this, but I think the
operating system can optimize two lookups of much smaller directories
rather than a single lookup of 100 000 entries. Just think of the
cycles spent after the `ls` and before the **Control-C**. Plus at some
point, web servers, etc. have to handle sorted lists of 100 000 entries.
Sorry, not going to do it.

So, after a minimal amount of testing, I settled on a two-letter prefix
followed by the full name for large (plugins, themes) lists. Of course, the
**wp** directory will always be an outlyer, still 8 692 is **much** less than
103 234 entries long (recent values). So there are about 900 prefix directories,
each with an average near 120 plugins or themes inside.

And of course, this being open-source, you can change it for your archive.
There is an `--prefixLength` option to alter the layout. A `prefixLength`
less than zero will give you a set of reports on how things break down for
prefix lengths of 1, 2, 3 and 4. Anything else, you need to hack some code.
A `--prefixLength=0` option should remove the prefix directory altogether, but
I didn't spend much time testing it.

#### Unicode Prefix Directory

There are Subversion directory names which have a first character with a
code point past 'z'. These I call "Unicode" or "Post-ASCII" directories
(although as a pedantic fool, I must point out that all directores are
named with Unicode characters.)

As of today, none of these plugins nor themes actually have been "released",
in that the `api.wordpress.org` API still does not recognize a **Post-ASCII** slug.

As an example of future proofing/over-engineering, these all get put into
a single **overflow** prefix directory, with the name `zz+`.

### live leaf directory

At the *leaf* of each plugin or theme directory structure is a **live**
directory. This directory contains an optional `screenshots` directory.
Plugins may have a `banners` directory. Themes have an optional `preview` directory.
The screenshots and banners are typically PNG format files, with some JPG or others.
The `preview` directory usually contains a single `index.html` file.

### meta leaf directory

Each plugin or theme has a directory that contains the **JSON** format files
that describe the item and its contents. There are usually two files in
the directory. A *legacy* file which comes from the upstream server, and
the *active* file which may be used to serve API content. The *active*
file may be patched with data from multiple data sources, and may be
redacted as well. It also has URLs translated to downsteam versions.

### read-only directory

Each plugin or theme has a directory that contains **Zip** format files.
These are the *contents* of the plugin or theme. They are archived
as **read-only** files as recieved from the upsteam source. The version
number is embedded in the file name. In a **full** archive, most
directories have multiple versions. In a **partial** archive, only a single
version is downloaded, although older versions are not purged.

### An example - acid-rain theme

The **partial** archive of the *acid-rain* theme includes the following files:

* `themes/meta/ac/acid-rain/theme.json`
* `themes/meta/ac/acid-rain/legacy-theme.json`
* `themes/read-only/ac/acid-rain/acid-rain.1.1.zip`

The **full** archive of the *acid-rain* theme adds the following files:

* `themes/live/ac/acid-rain/preview/index.html`
* `themes/live/ac/acid-rain/screenshots/screenshot.png`
* `themes/read-only/ac/acid-rain/acid-rain.1.0.1.zip`
* `themes/read-only/ac/acid-rain/acid-rain.1.0.zip`
