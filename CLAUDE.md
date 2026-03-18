# NIKKE Battle Simulator — Developer Notes

## Dev Server
This project uses plain ES modules — no build step needed.
To run locally, serve the project root via HTTP (not file://):

```bash
# Option 1: VS Code Live Server extension (recommended)
# Right-click index.html → Open with Live Server

# Option 2: Python
python -m http.server 5173

# Option 3: Node (once installed)
npx serve .
```

## Project Structure
```
src/data/      – CDN data fetching & caching
src/engine/    – Battle simulation logic
src/ui/        – UI components
scripts/       – Utility scripts (Node.js, run manually)
```

## Data Updates
When the game patches, CDN URL hashes change. Update `src/data/manifest.js`.
To find new URLs: open blablalink.com/shiftyspad in browser, check Network tab
for requests to sg-tools-cdn.blablalink.com.

## No npm / No TypeScript
Keep it plain JS. No package.json required for the main app.
