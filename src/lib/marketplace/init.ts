// Marketplace connector initialization.
// Import this file once at app startup to register all available connectors.

import { registerConnector } from "./service";
import { googleCloudConnector } from "./connectors/google-cloud";
import { azureConnector } from "./connectors/azure";
import { databricksConnector } from "./connectors/databricks";

// Register marketplace connectors
registerConnector(googleCloudConnector);
registerConnector(azureConnector);
registerConnector(databricksConnector);

// Future connectors:
// import { awsConnector } from "./connectors/aws";
// registerConnector(awsConnector);
