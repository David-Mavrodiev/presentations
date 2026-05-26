# Surgical RL Presentation - Local Web Server

This presentation is a static site and is easiest to run with `live-server`.

## Start (with file watching + auto reload)

From the repository root:

```bash
cd /Users/davidm/Documents/repos/presentations/devbg
npm_config_cache=$PWD/.npm-cache npx --yes live-server surgical-rl-presentation --port=5500 --open=index.html
```

Then open:

- http://127.0.0.1:5500/index.html

## Stop the server

In the terminal where the server is running, press:

- `Ctrl + C`

## Does it reload automatically?

Yes.

- Changes to existing files (HTML/CSS/JS/images) are watched and the browser reloads automatically.
- New files added under `surgical-rl-presentation` are served immediately once requested.
- If a newly added file is not yet referenced by the page, nothing will visibly change until you link to it or navigate to it.

## Troubleshooting

If you see `Cannot GET /index.html`, the server root is wrong.
Use the command above with `surgical-rl-presentation` explicitly passed as the served directory.
