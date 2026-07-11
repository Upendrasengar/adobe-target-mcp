import { toolLogger } from '../../../lib/logger.js';
import { getValidAdobeToken } from '../../../lib/adobe-auth.js';

/**
 * Function to list activities from Adobe Target.
 *
 * @param {Object} args - Arguments for the request.
 * @param {number} [args.limit=10] - Maximum number of activities to return (default: 10).
 * @param {number} [args.offset=0] - Number of activities to skip for pagination (default: 0).
 * @param {string} [args.state] - Filter by activity state (approved, saved, deactivated, etc.).
 * @param {string} [args.name] - Filter by activity name (exact name or substring).
 * @param {string} [args.type] - Filter by activity type (ab, xt, abt).
 * @param {number} [args.priority] - Filter by activity priority (0-999 or -10 for monitoring activities).
 * @returns {Promise<Object>} - The result of the activities listing.
 */
const executeFunction = async ({ limit = 10, offset = 0, state, name, type, priority }) => {
    const baseUrl = 'https://mc.adobe.io';
    const api_key = process.env.ADOBE_API_KEY;
    const tenant = process.env.ADOBE_TENANT;

    if (!api_key) {
        toolLogger.error('list_activities - ADOBE_API_KEY is not set in environment');
        return { error: 'ADOBE_API_KEY environment variable is not configured.' };
    }
    if (!tenant) {
        toolLogger.error('list_activities - ADOBE_TENANT is not set in environment');
        return { error: 'ADOBE_TENANT environment variable is not configured.' };
    }

    // Get a valid token (will refresh automatically if expired)
    let token;
    try {
        token = await getValidAdobeToken();
    } catch (error) {
        toolLogger.error(`list_activities - Failed to get Adobe token: ${error.message}`);
        return {
            error: `Failed to authenticate with Adobe: ${error.message}`
        };
    }

    toolLogger.info(`list_activities - Starting execution`);
    toolLogger.info(`list_activities - Tenant: ${tenant}`);
    toolLogger.info(`list_activities - API Key present: ${!!api_key}`);
    toolLogger.info(`list_activities - Token present: ${!!token}`);
    toolLogger.info(`list_activities - Limit: ${limit}, Offset: ${offset}`);
    toolLogger.info(`list_activities - Filters - State: ${state || 'none'}, Name: ${name || 'none'}, Type: ${type || 'none'}, Priority: ${priority !== undefined ? priority : 'none'}`);

    try {
        // Construct the URL with query parameters
        const url = new URL(`${baseUrl}/${tenant}/target/activities`);
        url.searchParams.append('limit', limit.toString());
        url.searchParams.append('offset', offset.toString());

        // Add optional filter parameters
        if (state) {
            url.searchParams.append('state', state);
        }
        if (name) {
            url.searchParams.append('name', name);
        }
        if (type) {
            url.searchParams.append('type', type);
        }
        if (priority !== undefined) {
            url.searchParams.append('priority', priority.toString());
        }

        toolLogger.info(`list_activities - Request URL: ${url.toString()}`);

        // Set up headers for the request
        const headers = {
            'Authorization': `Bearer ${token}`,
            'X-Api-Key': api_key,
            'Accept': 'application/vnd.adobe.target.v3+json'
        };

        toolLogger.info(`list_activities - Headers prepared (token masked)`);
        toolLogger.info(`list_activities - Making GET request...`);

        // Perform the fetch request
        const response = await fetch(url.toString(), {
            method: 'GET',
            headers
        });

        toolLogger.info(`list_activities - Response status: ${response.status} ${response.statusText}`);
        toolLogger.debug(`list_activities - Response headers`, Object.fromEntries(response.headers.entries()));

        // Check if the response was successful
        if (!response.ok) {
            toolLogger.error(`list_activities - Request failed with status: ${response.status}`);
            const errorData = await response.json();
            toolLogger.error(`list_activities - Error response`, errorData);
            throw new Error(JSON.stringify(errorData));
        }

        // Parse and return the response data
        const data = await response.json();
        toolLogger.success(`list_activities - Success! Retrieved ${data.activities ? data.activities.length : 'unknown'} activities`);
        toolLogger.debug(`list_activities - Response data`, data);
        return data;
    } catch (error) {
        toolLogger.error(`list_activities - Error occurred: ${error.message}`, { stack: error.stack });
        return {
            error: `An error occurred while listing activities: ${error instanceof Error ? error.message : JSON.stringify(error)}`
        };
    }
};

/**
 * Tool configuration for listing activities from Adobe Target.
 * @type {Object}
 */
const apiTool = {
    function: executeFunction,
    definition: {
        type: 'function',
        function: {
            name: 'list_activities',
            description: 'List activities from Adobe Target. API key and tenant are loaded from environment variables automatically.',
            parameters: {
                type: 'object',
                properties: {
                    limit: {
                        type: 'number',
                        description: 'Maximum number of activities to return (default: 10).',
                        default: 10,
                        minimum: 1,
                        maximum: 2147483647
                    },
                    offset: {
                        type: 'number',
                        description: 'Number of activities to skip for pagination (default: 0).',
                        default: 0,
                        minimum: 0
                    },
                    state: {
                        type: 'string',
                        description: 'Filter by activity state (approved, deactivated, paused, saved, deleted).',
                        enum: ['approved', 'deactivated', 'paused', 'saved', 'deleted']
                    },
                    name: {
                        type: 'string',
                        description: 'Filter by activity name (exact name or substring match).'
                    },
                    type: {
                        type: 'string',
                        description: 'Filter by activity type.',
                        enum: ['ab', 'xt', 'abt']
                    },
                    priority: {
                        type: 'number',
                        description: 'Filter by activity priority. Allowed values: 0-999 for regular activities, -10 for monitoring activities.',
                        minimum: -10,
                        maximum: 999
                    }
                },
                required: []
            }
        }
    }
};

export { apiTool };