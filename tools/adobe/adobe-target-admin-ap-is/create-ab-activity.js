import { toolLogger } from '../../../lib/logger.js';
import { getValidAdobeToken } from '../../../lib/adobe-auth.js';

/**
 * Function to create an AB activity in Adobe Target.
 *
 * @param {Object} args - Arguments for creating the AB activity.
 * @param {string} args.name - The name of the AB activity.
 * @param {Array} args.options - The options for the AB activity.
 * @param {Array} args.locations - The locations for the AB activity.
 * @param {Array} args.experiences - The experiences for the AB activity.
 * @param {string} args.workspace - The workspace ID.
 * @param {Array} args.propertyIds - The property IDs associated with the activity.
 * @param {Array} args.metrics - The metrics for the AB activity.
 * @returns {Promise<Object>} - The response from the Adobe Target API.
 */
const executeFunction = async ({ name, options, locations, experiences, workspace, propertyIds, metrics }) => {
    const baseUrl = 'https://mc.adobe.io';
    const tenant = process.env.ADOBE_TENANT;
    const apiKey = process.env.ADOBE_API_KEY;

    if (!apiKey) {
        toolLogger.error('create_ab_activity - ADOBE_API_KEY is not set in environment');
        return { error: 'ADOBE_API_KEY environment variable is not configured.' };
    }
    if (!tenant) {
        toolLogger.error('create_ab_activity - ADOBE_TENANT is not set in environment');
        return { error: 'ADOBE_TENANT environment variable is not configured.' };
    }


    // Get a valid token (will refresh automatically if expired)
    let token;
    try {
        token = await getValidAdobeToken();
    } catch (error) {
        toolLogger.error(`create_ab_activity - Failed to get Adobe token: ${error.message}`);
        return {
            error: `Failed to authenticate with Adobe: ${error.message}`
        };
    }


    const url = `${baseUrl}/${tenant}/target/activities/ab`;

    const requestBody = {
        name,
        options,
        locations,
        experiences,
        workspace,
        propertyIds,
        metrics
    };

    const body = JSON.stringify(requestBody);

    const headers = {
        'Authorization': `Bearer ${token}`,
        'X-Api-Key': apiKey,
        'Content-Type': 'application/vnd.adobe.target.v3+json'
    };


    try {
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body
        });


        if (!response.ok) {
            toolLogger.error(`create_ab_activity - Request failed with status: ${response.status}`);
            const errorData = await response.json();
            toolLogger.error(`create_ab_activity - Error response`, errorData);
            throw new Error(JSON.stringify(errorData));
        }

        const data = await response.json();
        toolLogger.success(`create_ab_activity - Success! Created activity with ID: ${data.id || 'Unknown'}`);
        toolLogger.debug(`create_ab_activity - Response data`, data);
        return data;
    } catch (error) {
        toolLogger.error(`create_ab_activity - Error occurred: ${error.message}`, { stack: error.stack });
        return {
            error: `An error occurred while creating the AB activity: ${error instanceof Error ? error.message : JSON.stringify(error)}`
        };
    }
};

/**
 * Tool configuration for creating an AB activity in Adobe Target.
 * @type {Object}
 */
const apiTool = {
    function: executeFunction,
    definition: {
        type: 'function',
        function: {
            name: 'create_ab_activity',
            description: 'Create an AB activity in Adobe Target.',
            parameters: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'The name of the AB activity.'
                    },
                    options: {
                        type: 'array',
                        description: 'The options for the AB activity.',
                        items: {
                            type: 'object'
                        }
                    },
                    locations: {
                        type: 'array',
                        description: 'The locations for the AB activity.',
                        items: {
                            type: 'object'
                        }
                    },
                    experiences: {
                        type: 'array',
                        description: 'The experiences for the AB activity.',
                        items: {
                            type: 'object'
                        }
                    },
                    workspace: {
                        type: 'string',
                        description: 'The workspace ID.'
                    },
                    propertyIds: {
                        type: 'array',
                        description: 'The property IDs associated with the activity.',
                        items: {
                            type: 'string'
                        }
                    },
                    metrics: {
                        type: 'array',
                        description: 'The metrics for the AB activity.',
                        items: {
                            type: 'object'
                        }
                    }
                },
                required: ['name', 'options', 'locations', 'experiences', 'workspace', 'propertyIds', 'metrics']
            }
        }
    }
};

export { apiTool };