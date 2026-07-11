import { toolLogger } from '../../../lib/logger.js';
import { getValidAdobeToken } from '../../../lib/adobe-auth.js';

const OFFER_TEMPLATE_ID = 133;
const VALID_ACTIVITY_TYPES = ['ab', 'xt'];

/**
 * Normalize an experience name the same way at-deploy.js does:
 * lowercase + spaces replaced with hyphens.
 * e.g. "Post Migration" → "post-migration"
 */
function normalizeExperienceName(name) {
    if (!name) return '';
    return name.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Function to update an Adobe Target activity with new HTML/JS code for one or more experiences.
 * Ported from JEDI at-deploy.js with full parity:
 *   - Deep-clones the activity payload before mutation
 *   - Matches experiences by normalized name
 *   - Creates new option slots when optionLocalId === 0
 *   - Prunes orphaned options after update
 *   - Deduplicates options with identical offerContent (avoids AT UniqueElements rejection)
 *   - Supports both AB and XT activity types
 *   - (Selector sync removed; selector must be managed via update-activity-selector tool)
 *
 * @param {Object} args
 * @param {string}   args.activityId        - The ID of the activity to update (MANDATORY).
 * @param {string}   args.newCode           - The new HTML/JS to inject into the target experience(s).
 * @param {string}   args.experienceName    - The Adobe Target experience name to update (e.g. "MCP Banner").
 *                                            Normalized to lowercase+hyphens for matching.
 * @param {string}  [args.activityType]     - Activity type: "ab" (default) or "xt".
 * @returns {Promise<Object>}
 */
const executeFunction = async ({ activityId, newCode, experienceName, activityType = 'ab' }) => {
    const baseUrl = 'https://mc.adobe.io';
    const finalApiKey = process.env.ADOBE_API_KEY;
    const tenant = process.env.ADOBE_TENANT;

    // ── Environment guards ──────────────────────────────────────────────────
    if (!finalApiKey) {
        toolLogger.error('update_activity - ADOBE_API_KEY is not set in environment');
        return { error: 'ADOBE_API_KEY environment variable is not configured.' };
    }
    if (!tenant) {
        toolLogger.error('update_activity - ADOBE_TENANT is not set in environment');
        return { error: 'ADOBE_TENANT environment variable is not configured.' };
    }

    // ── Parameter validation ────────────────────────────────────────────────
    const normalizedType = activityType.toLowerCase();
    if (!VALID_ACTIVITY_TYPES.includes(normalizedType)) {
        return { error: `Invalid activityType "${activityType}". Must be one of: ${VALID_ACTIVITY_TYPES.join(', ')}.` };
    }

    if (!experienceName || !experienceName.trim()) {
        return { error: 'experienceName is required. Provide the Adobe Target experience name to update.' };
    }

    const targetExpName = normalizeExperienceName(experienceName);
    toolLogger.info(`update_activity - Target experience (normalized): "${targetExpName}"`);

    // ── Auth ────────────────────────────────────────────────────────────────
    let token;
    try {
        token = await getValidAdobeToken();
    } catch (error) {
        toolLogger.error(`update_activity - Failed to get Adobe token: ${error.message}`);
        return { error: `Failed to authenticate with Adobe: ${error.message}` };
    }

    toolLogger.info(`update_activity - Starting execution`);
    toolLogger.info(`update_activity - Tenant: ${tenant}`);
    toolLogger.info(`update_activity - Activity ID: ${activityId} | Type: ${normalizedType}`);
    toolLogger.info(`update_activity - API Key present: ${!!finalApiKey}`);
    toolLogger.info(`update_activity - Token present: ${!!token}`);
    toolLogger.info(`update_activity - New code length: ${newCode?.length || 0} characters`);

    const activityUrl = `${baseUrl}/${tenant}/target/activities/${normalizedType}/${activityId}`;
    const commonHeaders = {
        'X-Api-Key': finalApiKey,
        Authorization: `Bearer ${token}`
    };

    try {
        // ── 1. GET current activity ─────────────────────────────────────────
        toolLogger.info(`update_activity - Fetching activity from: ${activityUrl}`);
        const getResponse = await fetch(activityUrl, {
            method: 'GET',
            headers: { ...commonHeaders, Accept: 'application/vnd.adobe.target.v3+json' }
        });

        if (!getResponse.ok) {
            const errorData = await getResponse.json();
            toolLogger.error(`update_activity - GET failed (${getResponse.status})`, errorData);
            throw new Error(`Failed to get activity: ${JSON.stringify(errorData)}`);
        }

        const activity = await getResponse.json();
        toolLogger.success(`update_activity - Retrieved activity: "${activity.name}" (state: ${activity.state})`);

        // ── 2. Live activity guard ──────────────────────────────────────────
        if (activity.state === 'approved') {
            toolLogger.error('update_activity - Activity is live (approved), cannot update');
            return {
                error: "Live activity cannot be updated. Deactivate it in Adobe Target first.",
                activityId,
                activityName: activity.name,
                state: activity.state
            };
        }

        // ── 3. Deep-clone payload (safe mutation, mirrors JEDI's JSON.parse/stringify) ──
        const newPayload = JSON.parse(JSON.stringify(activity));

        // ── 4. Track next available optionLocalId for creating new slots ────
        let nextOptionId = Math.max(...newPayload.options.map(o => o.optionLocalId)) + 1;

        /**
         * Create a new option with the given HTML content and append it to the payload.
         * Mirrors JEDI's createOption() helper exactly.
         * @returns {number} The new optionLocalId
         */
        function createOption(asset, label) {
            const newId = nextOptionId++;
            newPayload.options.push({
                optionLocalId: newId,
                name: `Offer ${newId}`,
                offerId: 0,
                offerTemplates: [{
                    offerTemplateId: OFFER_TEMPLATE_ID,
                    templateParameters: [
                        {
                            name: 'uiData',
                            value: JSON.stringify({ tagType: 'Code', actionType: 'added' })
                        },
                        {
                            name: 'offerContent',
                            value: asset
                        }
                    ]
                }]
            });
            toolLogger.info(`update_activity - Created new option[${newId}] for: ${label}`);
            return newId;
        }

        // ── 5. Update matching experiences ──────────────────────────────────
        const updatedExperiences = [];
        const skippedExperiences = [];
        const unchangedExperiences = [];
        const createdOptions = [];
        let anyChange = false;

        newPayload.experiences.forEach(exp => {
            const expNormalized = normalizeExperienceName(exp.name);

            if (expNormalized !== targetExpName) {
                skippedExperiences.push({ name: exp.name, reason: 'Not the target experience' });
                return;
            }

            toolLogger.info(`update_activity - Processing experience: "${exp.name}"`);
            let changed = false;

            exp.optionLocations.forEach(ol => {
                const { optionLocalId, locationLocalId } = ol;

                // No existing content → create a new option slot
                if (optionLocalId === 0) {
                    const newId = createOption(newCode, `${exp.name} → loc:${locationLocalId}`);
                    ol.optionLocalId = newId;
                    changed = true;
                    anyChange = true;
                    createdOptions.push(`${exp.name} → loc:${locationLocalId}`);
                    return;
                }

                const option = newPayload.options.find(o => o.optionLocalId === optionLocalId);
                if (!option) {
                    toolLogger.info(`update_activity - No option found for optionLocalId: ${optionLocalId}, skipping`);
                    return;
                }

                option.offerTemplates.forEach(offerTemplate => {
                    if (offerTemplate.offerTemplateId === OFFER_TEMPLATE_ID) {
                        offerTemplate.templateParameters.forEach(param => {
                            if (param.name === 'offerContent') {
                                if (param.value !== newCode) {
                                    toolLogger.info(`update_activity - Updating offerContent for: "${exp.name}" (loc:${locationLocalId})`);
                                    param.value = newCode;
                                    changed = true;
                                    anyChange = true;
                                } else {
                                    toolLogger.info(`update_activity - offerContent already matches for: "${exp.name}" (loc:${locationLocalId})`);
                                }
                            }
                        });
                    }
                });
            });

            if (changed) {
                updatedExperiences.push(exp.name);
            } else {
                unchangedExperiences.push(exp.name);
            }
        });

        // ── 6. Log experience summary ───────────────────────────────────────
        toolLogger.info(`update_activity - --- Experience Update Summary ---`);
        if (createdOptions.length > 0) {
            toolLogger.info(`update_activity - Created new options: ${createdOptions.join(', ')}`);
        }
        if (updatedExperiences.length > 0) {
            toolLogger.success(`update_activity - Updated experiences: ${updatedExperiences.join(', ')}`);
        }
        if (unchangedExperiences.length > 0) {
            toolLogger.info(`update_activity - No changes needed for: ${unchangedExperiences.join(', ')}`);
        }
        if (skippedExperiences.length > 0) {
            skippedExperiences.forEach(e => toolLogger.info(`update_activity - Skipped "${e.name}": ${e.reason}`));
        }

        if (!anyChange) {
            toolLogger.info('update_activity - No changes made. Code already matches or experience not found.');
            return {
                success: true,
                message: 'No changes needed — code already matches current offer content, or experience was not found.',
                activityId,
                activityName: activity.name,
                targetExperience: experienceName,
                updatedExperiences,
                skippedExperiences: skippedExperiences.map(e => e.name),
                unchangedExperiences
            };
        }

        // ── 7. Prune orphaned options ───────────────────────────────────────
        const referencedOptionIds = new Set();
        newPayload.experiences.forEach(exp => {
            exp.optionLocations.forEach(ol => referencedOptionIds.add(ol.optionLocalId));
        });
        const beforeCount = newPayload.options.length;
        newPayload.options = newPayload.options.filter(o => referencedOptionIds.has(o.optionLocalId));
        const pruned = beforeCount - newPayload.options.length;
        if (pruned > 0) {
            toolLogger.info(`update_activity - Pruned ${pruned} orphaned option(s)`);
        }

        // ── 8. Deduplicate options with identical offerContent ──────────────
        // Adobe Target rejects the PUT with UniqueElements error if two options
        // have byte-for-byte identical offerContent.
        {
            const contentToSurvivorId = new Map();
            const duplicateIdToSurvivorId = new Map();

            newPayload.options.forEach(opt => {
                if (opt.optionLocalId === 0) return; // never merge Default Content
                const offerContent = opt.offerTemplates
                    ?.find(t => t.offerTemplateId === OFFER_TEMPLATE_ID)
                    ?.templateParameters?.find(p => p.name === 'offerContent')?.value;
                if (offerContent === undefined) return;

                if (!contentToSurvivorId.has(offerContent)) {
                    contentToSurvivorId.set(offerContent, opt.optionLocalId);
                } else {
                    duplicateIdToSurvivorId.set(opt.optionLocalId, contentToSurvivorId.get(offerContent));
                }
            });

            if (duplicateIdToSurvivorId.size > 0) {
                // Remap optionLocations pointing at removed duplicates
                newPayload.experiences.forEach(exp => {
                    exp.optionLocations.forEach(ol => {
                        if (duplicateIdToSurvivorId.has(ol.optionLocalId)) {
                            ol.optionLocalId = duplicateIdToSurvivorId.get(ol.optionLocalId);
                        }
                    });
                });
                // Remove duplicate options
                const duplicateIds = new Set(duplicateIdToSurvivorId.keys());
                newPayload.options = newPayload.options.filter(o => !duplicateIds.has(o.optionLocalId));
                toolLogger.info(`update_activity - Deduplicated ${duplicateIds.size} option(s) with identical offerContent`);
            }
        }

        // ── 9. PUT updated activity ────────────────────────────────────────
        toolLogger.info(`update_activity - Sending PUT to: ${activityUrl}`);
        const putResponse = await fetch(activityUrl, {
            method: 'PUT',
            headers: {
                ...commonHeaders,
                'Content-Type': 'application/vnd.adobe.target.v3+json'
            },
            body: JSON.stringify(newPayload)
        });

        toolLogger.info(`update_activity - PUT response: ${putResponse.status} ${putResponse.statusText}`);

        if (!putResponse.ok) {
            const errorData = await putResponse.json();
            toolLogger.error(`update_activity - PUT failed (${putResponse.status})`, errorData);
            throw new Error(`Failed to update activity: ${JSON.stringify(errorData)}`);
        }

        const updatedActivity = await putResponse.json();
        toolLogger.success(`update_activity - Successfully deployed new code to activity!`);

        return {
            success: true,
            message: 'Activity updated successfully with new code.',
            activityId,
            activityName: updatedActivity.name || activity.name,
            activityType: normalizedType,
            targetExperience: experienceName,
            updatedExperiences,
            skippedExperiences: skippedExperiences.map(e => e.name),
            unchangedExperiences,
            createdOptions,
            prunedOptions: pruned,
            codeLength: newCode.length
        };

    } catch (error) {
        toolLogger.error(`update_activity - Error: ${error.message}`, { stack: error.stack });
        return {
            error: `An error occurred while updating the activity: ${error instanceof Error ? error.message : JSON.stringify(error)}`
        };
    }
};

/**
 * Tool configuration for updating an Adobe Target activity.
 * @type {Object}
 */
const apiTool = {
    function: executeFunction,
    definition: {
        type: 'function',
        function: {
            name: 'update_activity',
            description: [
                'Update an Adobe Target activity by injecting new HTML/JS code into a named experience.',
                'API key and tenant are loaded from environment variables automatically.',
                'Handles: deep-clone of payload, creating new option slots (optionLocalId=0),',
                'orphan pruning, offerContent deduplication (prevents UniqueElements AT error),',
                'and supports both AB and XT activity types.'
            ].join(' '),
            parameters: {
                type: 'object',
                properties: {
                    activityId: {
                        type: 'string',
                        description: 'The ID of the Adobe Target activity to update (MANDATORY).'
                    },
                    experienceName: {
                        type: 'string',
                        description: 'The Adobe Target experience name to update (e.g. "MCP Banner"). Matched case-insensitively.'
                    },
                    newCode: {
                        type: 'string',
                        description: 'The new HTML/JavaScript code to inject into the target experience.'
                    },
                    activityType: {
                        type: 'string',
                        description: 'The activity type: "ab" (default) or "xt".',
                        enum: ['ab', 'xt'],
                        default: 'ab'
                    }
                },
                required: ['activityId', 'experienceName', 'newCode']
            }
        }
    }
};

export { apiTool };