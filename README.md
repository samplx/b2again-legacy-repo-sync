# b2again-legacy-repo-sync

A set of [Deno](https://docs.deno.com/)
[Typescript](https://www.typescriptlang.org/docs/handbook/intro.html) programs that are
designed to create an unofficial mirror of a legacy CMS project's
public assets.

## Archive sizes

The tools support two modes. A **partial** archive is the default. This is just an archive of
the required meta data and the read-only zip files. Only the current version of
each plugin or theme is downloaded.
A **full** archive includes the
screenshot files, any preview pages, and **all** versions of **every** plugin or theme.
In fact, right now, both tools only support tracking **every** plugin or theme.

### Plugins

The preliminary numbers are ~30 GB for partial plugin download. Full download is in progress.

### Themes

The preliminary numbers are ~22 GB for partial themes download and 306 GB for a full download.

```
$ du -hs themes/*
5.0G	themes/live
351M	themes/meta
301G	themes/read-only
100M	themes/themes-status.json
```

## pluperfect.ts

A tool to mirror wordpress plugins and associated files.

## themattic.ts

A tool to mirror wordpress themes and associated files.

## Single threaded

Slow and steady doesn't put an undue burden on up-stream resources. Once
the archive is downloaded, updates are minimal and not time critical.
Again, it is open source, so someone can multi-thread it if they want.

## Directory structure

### `/live`

Contains mutable files associated with the "current" version. screenshots, sample pages. Only exists in **full** archive.

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
than one directory with over 100,000 entries. I will not replicate this
as a premature optimization. I have not tested this, but I think the
operating system can optimize two lookups of much smaller directories
rather than a single lookup of 100,000 entries. Just think of the
cycles spent after the `ls` and before the **Control-C**. Plus at some
point, web servers, etc. have to handle sorted lists of 100,000 entries. Sorry,
not going to do it.

So, after a minimal amount of testing, I settled on a two-letter prefix
followed by the full name for large (plugins, themes) lists. Of course, the
**wp** directory will always be an outlyer, it is still much less than
100,000 entries long.

And of course, this being open-source, you can change it for your archive.
There is an `--prefixLength` option to alter the layout. A `prefixLength`
less than zero will give you a set of reports on how things break down for
prefix lengths of 1, 2, 3 and 4. Anything else, you need to hack some code.
A `--prefixLength=0` option should remove the prefix directory altogether, but
I didn't spend much time testing it.

### live leaf directory

At the *leaf* of each plugin or theme directory structure is a **live**
directory. This directory contains an optional `screenshots`, as well
as an optional `preview` directory. The screenshots are typically
PNG format files. The `preview` directory usually contains a single
`index.html` file.

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

`themes/meta/ac/acid-rain/theme.json`
`themes/meta/ac/acid-rain/legacy-theme.json`
`themes/read-only/ac/acid-rain/acid-rain.1.1.zip`

The **full** archive of the *acid-rain* theme adds the following files:

`themes/live/ac/acid-rain/preview/index.html`
`themes/live/ac/acid-rain/screenshots/screenshot.png`
`themes/read-only/ac/acid-rain/acid-rain.1.0.1.zip`
`themes/read-only/ac/acid-rain/acid-rain.1.0.zip`
