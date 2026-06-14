#!/bin/bash
# VoiceClaw Agent Injection Script
# Usage: curl -s https://yourdomain.com/inject.sh | bash -s <AGENT_ID> [TARGET_FILE]

AGENT_ID=$1
TARGET_FILE=${2:-"index.html"}

if [ -z "$AGENT_ID" ]; then
  echo "❌ Error: Agent ID is required."
  echo "Usage: curl -s https://yourdomain.com/inject.sh | bash -s <AGENT_ID> [TARGET_FILE]"
  exit 1
fi

if [ ! -f "$TARGET_FILE" ]; then
  echo "❌ Error: Target file '$TARGET_FILE' not found!"
  exit 1
fi

HOST_URL="http://localhost:5173" # Change this to production URL when deploying
SCRIPT_TAG="<script src=\"$HOST_URL/embed.js\" data-agent-id=\"$AGENT_ID\"></script>"

# Check if already injected
if grep -q "data-agent-id=\"$AGENT_ID\"" "$TARGET_FILE"; then
  echo "⚠️ Agent $AGENT_ID is already injected in $TARGET_FILE"
  exit 0
fi

# Insert the script right before the closing </body> tag
# Works on macOS and Linux sed
sed -i.bak "s|</body>|$SCRIPT_TAG\n</body>|g" "$TARGET_FILE"

echo "✅ Successfully deployed VoiceClaw agent '$AGENT_ID' into $TARGET_FILE!"
echo "   (Backup saved as $TARGET_FILE.bak)"
