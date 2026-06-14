import json
import logging
from cryptography.fernet import Fernet
from config import settings

logger = logging.getLogger("encryption")

# Initialize Fernet key
fernet = None
if settings.ENCRYPTION_KEY:
    try:
        fernet = Fernet(settings.ENCRYPTION_KEY.encode())
    except Exception as e:
        logger.error(f"Failed to initialize Fernet encryption: {e}")
else:
    logger.warning("No ENCRYPTION_KEY found in environment. Connectors config will not be encrypted securely.")

def encrypt_config(config: dict) -> str:
    """Encrypt a dictionary configuration to a string."""
    if not config:
        return ""
    
    json_str = json.dumps(config)
    if not fernet:
        # Fallback if no key (not recommended for prod)
        return json_str
    
    return fernet.encrypt(json_str.encode()).decode()

def decrypt_config(encrypted: str) -> dict:
    """Decrypt a string back to a dictionary configuration."""
    if not encrypted:
        return {}
    
    if not fernet:
        try:
            return json.loads(encrypted)
        except:
            return {}
            
    try:
        decrypted_str = fernet.decrypt(encrypted.encode()).decode()
        return json.loads(decrypted_str)
    except Exception as e:
        logger.error(f"Failed to decrypt config: {e}")
        # Try returning as raw JSON if it wasn't encrypted (migration fallback)
        try:
            return json.loads(encrypted)
        except:
            return {}
