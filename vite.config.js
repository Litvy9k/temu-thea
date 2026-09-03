import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // 外部工具（预览面板、CI）靠 PORT 指定端口，Vite 默认不读它，
    // 不接过来的话它会自顾自地往后找空端口，别人就连不上了
    port: Number(process.env.PORT) || 5173,
  },
});
