"""Automated login flow for Zerodha Kite."""

import urllib.parse
from typing import Any

import httpx
import pyotp
from kiteconnect import KiteConnect

from app.core.exceptions import BrokerAuthError


async def generate_zerodha_access_token(
    user_id: str,
    password: str,
    totp_secret: str,
    api_key: str,
    api_secret: str,
) -> str:
    """Automate the Zerodha Kite login flow to generate an access_token.
    
    Args:
        user_id: Kite User ID
        password: Password
        totp_secret: TOTP Secret (Base32)
        api_key: Kite API Key
        api_secret: Kite API Secret
        
    Returns:
        The valid access_token for the session.
        
    Raises:
        BrokerAuthError: If authentication fails at any step.
    """
    login_url = "https://kite.zerodha.com/api/login"
    twofa_url = "https://kite.zerodha.com/api/twofa"
    auth_url = f"https://kite.trade/connect/login?api_key={api_key}&v=3"

    async with httpx.AsyncClient() as client:
        # Step 1: Initial Login to get request_id
        try:
            res = await client.post(
                login_url,
                data={"user_id": user_id, "password": password},
            )
            res_data = res.json()
            if res_data.get("status") != "success":
                raise BrokerAuthError(f"Login failed: {res_data.get('message', 'Unknown error')}")
            request_id = res_data["data"]["request_id"]
        except Exception as e:
            raise BrokerAuthError(f"Failed to authenticate with Zerodha (Step 1): {e}")

        # Step 2: Submit 2FA (TOTP)
        try:
            totp = pyotp.TOTP(totp_secret).now()
            res2 = await client.post(
                twofa_url,
                data={
                    "user_id": user_id,
                    "request_id": request_id,
                    "twofa_value": totp,
                    "twofa_type": "totp",
                },
            )
            res2_data = res2.json()
            if res2_data.get("status") != "success":
                raise BrokerAuthError(f"2FA failed: {res2_data.get('message', 'Unknown error')}")
        except Exception as e:
            raise BrokerAuthError(f"Failed to authenticate with Zerodha (Step 2 - 2FA): {e}")

        # Step 3: Get request_token by simulating OAuth redirect
        try:
            res3 = await client.get(auth_url, follow_redirects=False)
            
            # We expect a 302 redirect to our registered redirect_uri with the request_token
            location = res3.headers.get("Location") or res3.headers.get("location")
            if not location:
                # Sometimes it might redirect internally and return 302, let's try to follow redirects
                # and see the final URL if Location header is missing
                res3_follow = await client.get(auth_url, follow_redirects=True)
                final_url = str(res3_follow.url)
                parsed = urllib.parse.urlparse(final_url)
                query_params = urllib.parse.parse_qs(parsed.query)
            else:
                parsed = urllib.parse.urlparse(location)
                query_params = urllib.parse.parse_qs(parsed.query)
            
            request_token_list = query_params.get("request_token")
            if not request_token_list or not request_token_list[0]:
                raise BrokerAuthError("Could not extract request_token from redirect URL.")
            
            request_token = request_token_list[0]
        except Exception as e:
            raise BrokerAuthError(f"Failed to obtain request_token (Step 3): {e}")

    # Step 4: Exchange request_token for access_token using official library
    try:
        kite = KiteConnect(api_key=api_key)
        session_data = kite.generate_session(request_token, api_secret)
        access_token = session_data["access_token"]
        return access_token
    except Exception as e:
        raise BrokerAuthError(f"Failed to generate session with request_token: {e}")
