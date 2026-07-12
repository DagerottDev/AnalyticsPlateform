import hashlib
import requests
from fyers_apiv3 import fyersModel

# --- CONFIGURATION ---
# Replace these with your Fyers App credentials if they differ
APP_ID = "NI1WBOCXZQ-100"
API_SECRET = "TZC7VJE10V"
REDIRECT_URI = "http://127.0.0.1:3001"

def generate_manual_token():
    print("=== Fyers Manual Token Generator ===")
    
    # 1. Initialize session model
    session = fyersModel.SessionModel(
        client_id=APP_ID,
        secret_key=API_SECRET,
        redirect_uri=REDIRECT_URI,
        response_type="code",
        grant_type="authorization_code"
    )
    
    # 2. Print authorization URL
    auth_url = session.generate_authcode()
    print("\n1. Copy and paste the following URL into your browser:")
    print("-" * 80)
    print(auth_url)
    print("-" * 80)
    
    # 3. Prompt user for the redirect URL code
    print("\n2. Log in manually on Fyers. You will be redirected to a page that fails to load (since it is localhost).")
    print("3. Look at your browser address bar and copy the value of 'auth_code=...' in the URL.")
    
    auth_code = input("\nEnter the auth_code here: ").strip()
    
    # 4. Exchange auth code for access token
    try:
        session.set_token(auth_code)
        response = session.generate_token()
        
        if response.get("s") == "ok":
            access_token = response.get("access_token")
            print("\n" + "=" * 80)
            print("SUCCESS! Here is your Fyers Access Token:")
            print("-" * 80)
            print(access_token)
            print("=" * 80)
            print("\nCopy the access token above, go to the Manual Token tab on the login page, and paste it into the 'Access Token' input field.")
        else:
            print(f"\nFailed to generate token: {response.get('message', 'Unknown error')}")
    except Exception as e:
        print(f"\nError exchanging auth code: {e}")

if __name__ == "__main__":
    generate_manual_token()
