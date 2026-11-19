/** Port the world server listens on. Kept clear of Vite's dev port (5173). */
export const SERVER_PORT = Number(process.env['EPOCHS_PORT'] ?? 8787);
