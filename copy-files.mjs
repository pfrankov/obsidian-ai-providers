import { copyFileSync, mkdirSync, existsSync } from 'fs';

// Создаем папку dist если её нет
if (!existsSync('./dist')) {
    mkdirSync('./dist');
}

copyFileSync('./src/styles.css', './dist/styles.css');
copyFileSync('./manifest.json', './dist/manifest.json');