import { config } from 'dotenv';
// Root commands and workspace commands resolve the same local configuration.
// Existing runtime environment values always take priority.
config({ path: ['.env', '../../.env'] });
