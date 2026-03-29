// Marketplace connector initialization.
// Import this file once at app startup to register all available connectors.

import { registerConnector } from "./service";
import { googleCloudConnector } from "./connectors/google-cloud";

// Register Google Cloud Marketplace connector
registerConnector(googleCloudConnector);

// Future connectors:
// import { azureConnector } from "./connectors/azure";
// registerConnector(azureConnector);
//
// import { awsConnector } from "./connectors/aws";
// registerConnector(awsConnector);
