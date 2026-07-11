import { logger } from './logger.js';

// Adobe IMS constants
const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
const IMS_SCOPE = 'openid,AdobeID,target_sdk,additional_info.roles,read_organizations,additional_info.projectedProductContext';

// Token cache with expiration
let tokenCache = {
  token: null,
  expiresAt: null
};

/**
 * Fetch Adobe OAuth token using client credentials
 * @returns {Promise<string>} Access token
 */
async function fetchAdobeToken() {
  const data = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.ADOBE_CLIENT_ID,
    client_secret: process.env.ADOBE_CLIENT_SECRET,
    scope: IMS_SCOPE
  });

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded'
  };

  try {
    logger.info('Fetching new Adobe OAuth token...');
    const response = await fetch(IMS_TOKEN_URL, {
      method: 'POST',
      headers,
      body: data
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      logger.error('Adobe token request failed:', errorData);
      throw new Error(`Adobe token fetch failed: ${errorData.error_description || response.statusText}`);
    }
    
    const responseData = await response.json();
    const { access_token, expires_in } = responseData;
    
    // Calculate expiration time (subtract 5 minutes for safety buffer)
    const expiresAt = Date.now() + ((expires_in - 300) * 1000);
    
    logger.success('Successfully fetched Adobe OAuth token');
    logger.debug(`Token expires in ${expires_in} seconds`);
    
    return { access_token, expiresAt };
  } catch (err) {
    logger.error('Failed to fetch Adobe token:', err.message);
    throw new Error(`Adobe token fetch failed: ${err.message}`);
  }
}

/**
 * Get a valid Adobe token, refreshing if necessary
 * @returns {Promise<string>} Valid access token
 */
export async function getValidAdobeToken() {
  // Check if we have a cached token that's still valid
  if (tokenCache.token && tokenCache.expiresAt && Date.now() < tokenCache.expiresAt) {
    logger.debug('Using cached Adobe token');
    return tokenCache.token;
  }

  // Token is expired or doesn't exist, fetch a new one
  logger.info('Adobe token expired or missing, fetching new token...');
  
  try {
    const { access_token, expiresAt } = await fetchAdobeToken();
    
    // Update cache
    tokenCache = {
      token: access_token,
      expiresAt: expiresAt
    };
    
    return access_token;
  } catch (error) {
    logger.error('Failed to get valid Adobe token:', error.message);
    throw error;
  }
}

/**
 * Clear the token cache (useful for testing or forcing refresh)
 */
export function clearTokenCache() {
  logger.info('Clearing Adobe token cache');
  tokenCache = {
    token: null,
    expiresAt: null
  };
}

/**
 * Get token cache status for debugging
 * @returns {Object} Cache status information
 */
export function getTokenCacheStatus() {
  const now = Date.now();
  const isValid = tokenCache.token && tokenCache.expiresAt && now < tokenCache.expiresAt;
  const timeUntilExpiry = tokenCache.expiresAt ? Math.max(0, tokenCache.expiresAt - now) : 0;
  
  return {
    hasToken: !!tokenCache.token,
    isValid,
    expiresAt: tokenCache.expiresAt ? new Date(tokenCache.expiresAt).toISOString() : null,
    timeUntilExpiryMs: timeUntilExpiry,
    timeUntilExpiryMinutes: Math.floor(timeUntilExpiry / (1000 * 60))
  };
}