import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          login: path.resolve(__dirname, 'login.html'),
          register: path.resolve(__dirname, 'register.html'),
          dashboardUmkm: path.resolve(__dirname, 'dashboard-umkm.html'),
          campaignNew: path.resolve(__dirname, 'campaign-new.html'),
          campaignDetail: path.resolve(__dirname, 'campaign-detail.html'),
          dashboardCreator: path.resolve(__dirname, 'dashboard-creator.html'),
          campaignBrowse: path.resolve(__dirname, 'campaign-browse.html'),
          walletCreator: path.resolve(__dirname, 'wallet-creator.html'),
          dashboardAdmin: path.resolve(__dirname, 'dashboard-admin.html'),
          adminUsers: path.resolve(__dirname, 'admin-users.html'),
          adminTransactions: path.resolve(__dirname, 'admin-transactions.html'),
          creatorAnalytics: path.resolve(__dirname, 'creator-analytics.html'),
          creatorProfile: path.resolve(__dirname, 'creator-profile.html'),
          umkmProfile: path.resolve(__dirname, 'umkm-profile.html'),
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
