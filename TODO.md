# tsk — TODO

## Phase 1: Foundation
- [x] Init project, install `@opentui/core` + `@opentui/react`
- [x] Create `bin/tsk.tsx` entry point con renderer
- [x] Create `<App />` con header + content area + status bar
- [x] Implementar color theme (Tokyo Night)
- [x] Verificar que arranca: `bun run bin/tsk.tsx`
- [x] Consolidar estructura (eliminar carpeta anidada)

## Phase 2: Data Layer
- [x] Definir tipos TypeScript (`Task`, `AppState`, `FilterState`)
- [x] Implementar `TaskStore` con CRUD en memoria
- [x] Añadir persistencia JSON (`~/.tsk/tasks.json`)
- [x] Añadir auto-save con debounce (300ms)

## Phase 3: Task List View
- [x] Componente `<TaskRow />` con estilos
- [x] Vista `<TaskListView />` con scrollable list
- [x] Navegación `j/k` con `useKeyboard`
- [x] Highlighting de fila seleccionada
- [x] Panel `<TaskDetailPanel />` (derecha)
- [x] `Tab` para cambiar foco entre paneles

## Phase 4: Task Actions
- [x] Componente `<Modal />` wrapper
- [x] `<InputModal />` para añadir tareas (`a`)
- [x] Editar tareas (`e`) reutilizando InputModal
- [x] Toggle done/undone (`d`)
- [x] Borrar con `<ConfirmModal />` (`x`)
- [x] `<SelectModal />` para prioridad (`!`)
- [x] Asignar proyecto (`p`)
- [x] Gestionar tags (`t`)
- [x] Establecer due date (`D`)

## Phase 5: Search & Filter
- [x] Search overlay (`/`) con filtrado en tiempo real
- [x] Ciclar filtro de status (`f`)
- [x] Ciclar sort (`s`)
- [x] Indicadores de filtro/sort en status bar

## Phase 6: Additional Views
- [x] Project Board view — kanban 3 columnas
- [x] Navegación entre columnas (`h/l`) y mover tareas (`Shift+H/L`)
- [x] Calendar view con grid mensual
- [x] Help overlay (`?`) con todos los keybindings

## Phase 7: CLI Interface
- [x] Parser de CLI args (subcomandos + flags)
- [x] `tsk add "título"` con flags `-p`, `-P`, `--tag`, `--due`
- [x] `tsk list` con filtros (`--status`, `--priority`, `--project`, `--json`)
- [x] `tsk show <id>`, `tsk edit <id>`, `tsk done <id>`
- [x] `tsk rm <id>` con confirmación
- [x] `tsk search`, `tsk projects`, `tsk tags`
- [x] `--help`, `--version`
- [x] Partial ID resolution
- [x] Exit codes (0-4)

## Phase 8: Polish & Distribution
- [x] Animaciones (completion flash, modal fade-in)
- [x] Undo (`u`) — already implemented in Phase 4
- [x] Layout responsive (`useTerminalDimensions`)
- [x] Empty states, validación, error recovery
- [x] `bun build --compile` para binarios
- [x] Script `install.sh` para curl
- [x] README con instrucciones completas
- [x] Testing manual en distintos tamaños de terminal
