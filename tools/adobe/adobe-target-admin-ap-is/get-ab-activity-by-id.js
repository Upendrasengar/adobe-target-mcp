import { toolLogger } from '../../../lib/logger.js';
import { getValidAdobeToken } from '../../../lib/adobe-auth.js';

const VALID_ACTIVITY_TYPES = ['ab', 'xt'];

/**
 * Function to get an Adobe Target activity by ID.
 * Supports both AB and XT activity types.
 *
 * @param {Object} args
 * @param {string}  args.activityId    - The ID of the activity to retrieve.
 * @param {string} [args.activityType] - Activity type: "ab" (default) or "xt".
 * @returns {Promise<Object>}
 */
const executeFunction = async ({ activityId, activityType = 'ab' }) => {
    const baseUrl = 'https://mc.adobe.io';
    const apiKey = process.env.ADOBE_API_KEY;
    const tenant = process.env.ADOBE_TENANT;

    // ── Environment guards ──────────────────────────────────────────────────
    if (!apiKey) {
        toolLogger.error('get_activity_by_id - ADOBE_API_KEY is not set in environment');
        return { error: 'ADOBE_API_KEY environment variable is not configured.' };
    }
    if (!tenant) {
        toolLogger.error('get_activity_by_id - ADOBE_TENANT is not set in environment');
        return { error: 'ADOBE_TENANT environment variable is not configured.' };
    }

    // ── Parameter validation ────────────────────────────────────────────────
    const normalizedType = activityType.toLowerCase();
    if (!VALID_ACTIVITY_TYPES.includes(normalizedType)) {
        return { error: `Invalid activityType "${activityType}". Must be one of: ${VALID_ACTIVITY_TYPES.join(', ')}.` };
    }

    // ── Auth ────────────────────────────────────────────────────────────────
    let token;
    try {
        token = await getValidAdobeToken();
    } catch (error) {
        toolLogger.error(`get_activity_by_id - Failed to get Adobe token: ${error.message}`);
        return { error: `Failed to authenticate with Adobe: ${error.message}` };
    }

    toolLogger.info(`get_activity_by_id - Starting execution`);
    toolLogger.info(`get_activity_by_id - Tenant: ${tenant}`);
    toolLogger.info(`get_activity_by_id - Activity ID: ${activityId} | Type: ${normalizedType}`);
    toolLogger.info(`get_activity_by_id - API Key present: ${!!apiKey}`);
    toolLogger.info(`get_activity_by_id - Token present: ${!!token}`);

    try {
        const url = `${baseUrl}/${tenant}/target/activities/${normalizedType}/${activityId}`;
        toolLogger.info(`get_activity_by_id - Request URL: ${url}`);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'X-Api-Key': apiKey,
                'Accept': 'application/vnd.adobe.target.v3+json',
                Authorization: `Bearer ${token}`
            }
        });

        toolLogger.info(`get_activity_by_id - Response status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errorData = await response.json();
            toolLogger.error(`get_activity_by_id - Request failed (${response.status})`, errorData);
            throw new Error(JSON.stringify(errorData));
        }

        const data = await response.json();
        toolLogger.success(`get_activity_by_id - Retrieved activity: "${data.name || 'Unknown'}" (state: ${data.state})`);
        return data;

    } catch (error) {
        toolLogger.error(`get_activity_by_id - Error: ${error.message}`, { stack: error.stack });
        return {
            error: `An error occurred while getting activity by ID: ${error instanceof Error ? error.message : JSON.stringify(error)}`
        };
    }
};

/**
 * Tool configuration for getting an Adobe Target activity by ID.
 * @type {Object}
 */
const apiTool = {
    function: executeFunction,
    definition: {
        type: 'function',
        function: {
            name: 'get_activity_by_id',
            description: 'Get an Adobe Target activity by ID. Supports both AB and XT activity types. API key and tenant are loaded from environment variables automatically.',
            parameters: {
                type: 'object',
                properties: {
                    activityId: {
                        type: 'string',
                        description: 'The ID of the activity to retrieve.'
                    },
                    activityType: {
                        type: 'string',
                        description: 'The activity type: "ab" (default) or "xt".',
                        enum: ['ab', 'xt'],
                        default: 'ab'
                    }
                },
                required: ['activityId']
            }
        }
    }
};

export { apiTool };