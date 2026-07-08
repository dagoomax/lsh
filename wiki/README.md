# LSH Wiki source

These Markdown pages are formatted for the **GitHub Wiki** (`Home.md`, `_Sidebar.md`, `_Footer.md`, and topic pages with relative `[links](Page-Name)`). They are generated from the repo's `README.md` and `docs/`.

## Publish to the GitHub wiki

GitHub wikis are a separate git repo. Once the wiki is enabled for the repo (create the first page via the web UI once), push these files:

```bash
git clone https://github.com/dagoomax/lsh.wiki.git
cp wiki/*.md lsh.wiki/
cd lsh.wiki && git add -A && git commit -m "Sync wiki from repo docs" && git push
```

## Browse locally

Any Markdown viewer works, or serve the folder:

```bash
npx docsify-serve wiki    # or: grip wiki/Home.md
```

## Keeping it in sync

The topic pages are sliced from `README.md`; the connective pages (`Home`, `Loxone-Integration`, `UniFi-Door-Station`, `Remote-Access-and-Security`) are hand-authored. When `README.md` changes materially, regenerate the sliced pages or edit both.
