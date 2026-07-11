import { toolLogger } from '../../../lib/logger.js';
import { getValidAdobeToken } from '../../../lib/adobe-auth.js';

/**
 * Function to update the name of an activity in Adobe Target.
 *
 * @param {Object} args - Arguments for the update.
 * @param {string} args.activityId - The ID of the activity to update.
 * @param {string} args.name - The new name for the activity.
 * @returns {Promise<Object>} - The result of the update operation.
 */
const executeFunction = async ({ activityId, name }) => {
  const baseUrl = 'https://mc.adobe.io';
  const apiKey = process.env.ADOBE_API_KEY;
  const tenant = process.env.ADOBE_TENANT;

  if (!apiKey) {
    toolLogger.error('update_activity_name - ADOBE_API_KEY is not set in environment');
    return { error: 'ADOBE_API_KEY environment variable is not configured.' };
  }
  if (!tenant) {
    toolLogger.error('update_activity_name - ADOBE_TENANT is not set in environment');
    return { error: 'ADOBE_TENANT environment variable is not configured.' };
  }

  // Get a valid token (will refresh automatically if expired)
  let token;
  try {
    token = await getValidAdobeToken();
  } catch (error) {
    toolLogger.error(`update_activity_name - Failed to get Adobe token: ${error.message}`);
    return {
      error: `Failed to authenticate with Adobe: ${error.message}`
    };
  }


  try {
    // Construct the URL for the request
    const url = `${baseUrl}/${tenant}/target/activities/${activityId}/name`;

    // Set up headers for the request
    const headers = {
      'Authorization': `Bearer ${token}`,
      'X-Api-Key': apiKey,
      'Content-Type': 'application/vnd.adobe.target.v1+json'
    };

    // Prepare the request body
    const requestBody = { name };
    const body = JSON.stringify(requestBody);


    // Perform the fetch request
    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body
    });


    // Check if the response was successful
    if (!response.ok) {
      toolLogger.error(`update_activity_name - Request failed with status: ${response.status}`);
      const errorData = await response.json();
      toolLogger.error(`update_activity_name - Error response`, errorData);
      throw new Error(JSON.stringify(errorData));
    }

    // Parse and return the response data
    const data = await response.json();
    toolLogger.success(`update_activity_name - Success! Updated activity name`);
    toolLogger.debug(`update_activity_name - Response data`, data);
    return data;
  } catch (error) {
    toolLogger.error(`update_activity_name - Error occurred: ${error.message}`, { stack: error.stack });
    return {
      error: `An error occurred while updating the activity name: ${error instanceof Error ? error.message : JSON.stringify(error)}`
    };
  }
};

/**
 * Tool configuration for updating activity name in Adobe Target.
 * @type {Object}
 */
const apiTool = {
  function: executeFunction,
  definition: {
    type: 'function',
    function: {
      name: 'update_activity_name',
      description: 'Update the name of an activity in Adobe Target. API key and tenant are loaded from environment variables automatically.',
      parameters: {
        type: 'object',
        properties: {
          activityId: {
            type: 'string',
            description: 'The ID of the activity to update.'
          },
          name: {
            type: 'string',
            description: 'The new name for the activity.'
          }
        },
        required: ['activityId', 'name']
      }
    }
  }
};

export { apiTool };