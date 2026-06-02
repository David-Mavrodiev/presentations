# Surgical RL Presentation - Local Web Server

This presentation is a static site. `start-presentation.ps1` serves the deck and, when the Python policy dependencies are installed, also starts the vessel-squeeze policy API used by the interactive demo.

## Start on Windows

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-presentation.ps1
```

Then open:

- http://127.0.0.1:8000/index-bg.html

If the policy Python dependencies are missing, the deck still stays online, but the interactive policy demo will not call `http://127.0.0.1:5000` until those dependencies are installed.

## Optional policy demo dependencies

Use a virtual environment so the policy server dependencies stay local to the project:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r .\clip-application-surrol\requirements.txt
powershell -ExecutionPolicy Bypass -File .\start-presentation.ps1
```

When `.venv` exists, the launcher uses `.\.venv\Scripts\python.exe` automatically; activating the environment is not required.

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
