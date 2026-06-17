# Replisa

Ad-free replicas of mobile games, built as a Progressive Web App.

🌐 **[Play online](https://meoiswa.github.io/replisa/)**

## Games

### 🐱 Cat Queens
A hybrid sudoku/nonogram puzzle. Place one cat in each row, column, and color region — no two cats can touch, even diagonally.

- Procedurally generated levels with a shared seed (everyone gets the same puzzles)
- Grid size grows at Fibonacci-numbered levels (4×4 → 5×5 → 6×6 → …)
- Earn a hint every 5 minutes; hints explain the logical deduction
- Misses are tracked (placing a cat in the wrong cell)

## Adding New Games

1. Create a folder under `src/games/<your-game>/`
2. Export a `render<YourGame>(params)` function
3. Register the route in `src/router.ts`
4. Add a card in `src/home.ts`

## Development

```bash
npm install
npm run dev      # start dev server
npm run build    # production build → dist/
npm run preview  # preview production build
```

## Deployment

Pushes to `main` automatically deploy to [GitHub Pages](https://meoiswa.github.io/replisa/) via GitHub Actions.

## License

MIT — see [LICENSE](LICENSE)

## Agent Disclosure

See [AGENT.md](AGENT.md)
