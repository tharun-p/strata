import { writeFile } from 'node:fs/promises'

// Go's package discovery otherwise descends into JavaScript dependencies that
// happen to contain .go fixtures. A tiny nested module keeps `go test ./...`
// focused on Strata without changing npm or Vite's standard directory layout.
await writeFile(new URL('../node_modules/go.mod', import.meta.url), 'module strata_frontend_dependencies\n\ngo 1.24.0\n')

