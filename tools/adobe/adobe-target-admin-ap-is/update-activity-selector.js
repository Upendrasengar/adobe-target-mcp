import { toolLogger } from '../../../lib/logger.js';
import { getValidAdobeToken } from '../../../lib/adobe-auth.js';

const VALID_ACTIVITY_TYPES = ['ab', 'xt'];

/**
 * Update one or more location selectors in an Adobe Target activity.
 *
 * Adobe Target uses CSS selectors stored in activity.locations[].selector to
 * determine where content is injected on the page. This tool lets you update
 * those selectors independently of offer content — useful when the activity's
 * primary selector (e.g. "BODY > *:eq(0)") does not match the intended
 * injection target (e.g. "#business").
 *
 * @param {Object}   args
 * @param {string}   args.activityId        - ID of the activity to update (MANDATORY).
 * @param {Object[]} args.selectorUpdates   - Array of selector updates to apply.
 *   Each entry: { locationName: string, newSelector: string }
 *   - locationName: the location's "name" field in Adobe Target (case-insensitive match)
 *   - newSelector:  the new CSS selector to set (e.g. "#business")
 * @param {string}  [args.activityType]     - "ab" (default) or "xt".
 * @returns {Promise<Object>}
 */
const executeFunction = async ({ activityId, selectorUpdates, activityType = 'ab' }) => {
    const baseUrl = 'https://mc.adobe.io';
    const apiKey = process.env.ADOBE_API_KEY;
    const tenant = process.env.ADOBE_TENANT;

    // ── Environment guards ──────────────────────────────────────────────────
    if (!apiKey) {
        toolLogger.error('update_activity_selector - ADOBE_API_KEY is not set in environment');
        return { error: 'ADOBE_API_KEY environment variable is not configured.' };
    }
    if (!tenant) {
        toolLogger.error('update_activity_selector - ADOBE_TENANT is not set in environment');
        return { error: 'ADOBE_TENANT environment variable is not configured.' };
    }

    // ── Parameter validation ────────────────────────────────────────────────
    const normalizedType = activityType.toLowerCase();
    if (!VALID_ACTIVITY_TYPES.includes(normalizedType)) {
        return { error: `Invalid activityType "${activityType}". Must be one of: ${VALID_ACTIVITY_TYPES.join(', ')}.` };
    }
    if (!Array.isArray(selectorUpdates) || selectorUpdates.length === 0) {
        return { error: 'selectorUpdates must be a non-empty array of { locationName, newSelector } objects.' };
    }
    for (const update of selectorUpdates) {
        if (!update.locationName || !update.newSelector) {
            return { error: 'Each selectorUpdate must have both "locationName" and "newSelector" fields.' };
        }
    }

    // ── Auth ────────────────────────────────────────────────────────────────
    let token;
    try {
        token = await getValidAdobeToken();
    } catch (error) {
        toolLogger.error(`update_activity_selector - Failed to get Adobe token: ${error.message}`);
        return { error: `Failed to authenticate with Adobe: ${error.message}` };
    }

    toolLogger.info(`update_activity_selector - Starting execution`);
    toolLogger.info(`update_activity_selector - Activity ID: ${activityId} | Type: ${normalizedType}`);
    toolLogger.info(`update_activity_selector - ${selectorUpdates.length} selector update(s) requested`);

    const activityUrl = `${baseUrl}/${tenant}/target/activities/${normalizedType}/${activityId}`;
    const commonHeaders = {
        'X-Api-Key': apiKey,
        Authorization: `Bearer ${token}`
    };

    try {
        // ── 1. GET current activity ─────────────────────────────────────────
        toolLogger.info(`update_activity_selector - Fetching activity from: ${activityUrl}`);
        const getResponse = await fetch(activityUrl, {
            method: 'GET',
            headers: { ...commonHeaders, Accept: 'application/vnd.adobe.target.v3+json' }
        });

        if (!getResponse.ok) {
            const errorData = await getResponse.json();
            toolLogger.error(`update_activity_selector - GET failed (${getResponse.status})`, errorData);
            throw new Error(`Failed to get activity: ${JSON.stringify(errorData)}`);
        }

        const activity = await getResponse.json();
        toolLogger.success(`update_activity_selector - Retrieved activity: "${activity.name}" (state: ${activity.state})`);

        // ── 2. Live activity guard ──────────────────────────────────────────
        if (activity.state === 'approved') {
            return {
                error: 'Live activity cannot be updated. Deactivate it in Adobe Target first.',
                activityId,
                activityName: activity.name,
                state: activity.state
            };
        }

        // ── 3. Deep-clone payload ───────────────────────────────────────────
        const newPayload = JSON.parse(JSON.stringify(activity));

        // Log the current locations for reference
        toolLogger.info(`update_activity_selector - Current locations:`);
        (newPayload.locations || []).forEach((loc, i) => {
            toolLogger.info(`  [${i}] name="${loc.name}" selector="${loc.selector}"`);
        });

        // ── 4. Apply selector updates ───────────────────────────────────────
        const applied = [];
        const notFound = [];

        for (const { locationName, newSelector } of selectorUpdates) {
            const loc = (newPayload.locations || []).find(
                l => l.name?.toLowerCase() === locationName.toLowerCase()
            );

            if (!loc) {
                toolLogger.error(`update_activity_selector - Location not found: "${locationName}"`);
                notFound.push(locationName);
                continue;
            }

            const oldSelector = loc.selector;
            if (oldSelector === newSelector) {
                toolLogger.info(`update_activity_selector - Selector already matches for "${locationName}", skipping`);
                applied.push({ locationName, oldSelector, newSelector, changed: false });
                continue;
            }

            toolLogger.info(`update_activity_selector - Updating "${locationName}": "${oldSelector}" → "${newSelector}"`);
            loc.selector = newSelector;
            applied.push({ locationName, oldSelector, newSelector, changed: true });
        }

        const anyChanged = applied.some(a => a.changed);

        if (!anyChanged && notFound.length === 0) {
            return {
                success: true,
                message: 'No selector changes needed — all selectors already match.',
                activityId,
                activityName: activity.name,
                applied
            };
        }

        if (notFound.length > 0 && applied.filter(a => a.changed).length === 0) {
            return {
                error: `None of the specified location names were found in the activity. Not found: ${notFound.join(', ')}`,
                availableLocations: (newPayload.locations || []).map(l => ({ name: l.name, selector: l.selector }))
            };
        }

        // ── 5. PUT updated activity ─────────────────────────────────────────
        toolLogger.info(`update_activity_selector - Sending PUT to: ${activityUrl}`);
        const putResponse = await fetch(activityUrl, {
            method: 'PUT',
            headers: {
                ...commonHeaders,
                'Content-Type': 'application/vnd.adobe.target.v3+json'
            },
            body: JSON.stringify(newPayload)
        });

        toolLogger.info(`update_activity_selector - PUT response: ${putResponse.status} ${putResponse.statusText}`);

        if (!putResponse.ok) {
            const errorData = await putResponse.json();
            toolLogger.error(`update_activity_selector - PUT failed (${putResponse.status})`, errorData);
            throw new Error(`Failed to update activity: ${JSON.stringify(errorData)}`);
        }

        const updatedActivity = await putResponse.json();
        toolLogger.success(`update_activity_selector - Successfully updated location selector(s)!`);

        return {
            success: true,
            message: 'Location selector(s) updated successfully.',
            activityId,
            activityName: updatedActivity.name || activity.name,
            activityType: normalizedType,
            applied,
            notFound: notFound.length > 0 ? notFound : undefined
        };

    } catch (error) {
        toolLogger.error(`update_activity_selector - Error: ${error.message}`, { stack: error.stack });
        return {
            error: `An error occurred while updating location selectors: ${error instanceof Error ? error.message : JSON.stringify(error)}`
        };
    }
};

/**
 * Tool configuration for updating Adobe Target activity location selectors.
 * @type {Object}
 */
const apiTool = {
    function: executeFunction,
    definition: {
        type: 'function',
        function: {
            name: 'update_activity_selector',
            description: [
                'Update one or more location selectors in an Adobe Target activity.',
                'Use this when the activity\'s primary location selector (e.g. "BODY > *:eq(0)")',
                'does not match the intended CSS injection target (e.g. "#business").',
                'Returns a list of available location names if the specified name is not found.',
                'API key and tenant are loaded from environment variables automatically.',
                'Supports both AB and XT activity types.'
            ].join(' '),
            parameters: {
                type: 'object',
                properties: {
                    activityId: {
                        type: 'string',
                        description: 'The ID of the Adobe Target activity to update (MANDATORY).'
                    },
                    selectorUpdates: {
                        type: 'array',
                        description: 'List of location selector updates to apply.',
                        items: {
                            type: 'object',
                            properties: {
                                locationName: {
                                    type: 'string',
                                    description: 'The name of the location in Adobe Target (case-insensitive). Use get_activity_by_id to see all location names.'
                                },
                                newSelector: {
                                    type: 'string',
                                    description: 'The new CSS selector to set (e.g. "#business", ".hero-banner", "BODY > *:eq(0)").'
                                }
                            },
                            required: ['locationName', 'newSelector']
                        }
                    },
                    activityType: {
                        type: 'string',
                        description: 'The activity type: "ab" (default) or "xt".',
                        enum: ['ab', 'xt'],
                        default: 'ab'
                    }
                },
                required: ['activityId', 'selectorUpdates']
            }
        }
    }
};

export { apiTool };
