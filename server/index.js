import { app } from './app.js';
import { config } from './config.js';

app.listen(config.port, () => console.log(`Buypal is running at http://localhost:${config.port}`));
