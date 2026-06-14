(function () {
  // Find the script tag that loaded this script
  var scriptTag = document.currentScript;
  if (!scriptTag) {
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src.indexOf("embed.js") !== -1) {
        scriptTag = scripts[i];
        break;
      }
    }
  }

  if (!scriptTag) {
    console.error("VoiceClaw: Could not find script tag.");
    return;
  }

  var agentId = scriptTag.getAttribute("data-agent-id");
  if (!agentId) {
    console.error("VoiceClaw: Missing data-agent-id attribute.");
    return;
  }

  // Derive the host URL dynamically from the script source
  var hostUrl = new URL(scriptTag.src).origin;
  var agentUrl = hostUrl + "/agent/" + agentId + "/talk?embed=true";

  // Create the iframe container
  var container = document.createElement("div");
  container.id = "voiceclaw-embed-container";
  container.style.position = "fixed";
  container.style.bottom = "20px";
  container.style.right = "20px";
  container.style.width = "80px";
  container.style.height = "80px";
  container.style.zIndex = "999999";
  container.style.transition = "all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
  container.style.borderRadius = "40px";
  container.style.boxShadow = "0 10px 40px rgba(0, 0, 0, 0.1)";
  container.style.overflow = "hidden";
  container.style.backgroundColor = "transparent";

  // Create the iframe
  var iframe = document.createElement("iframe");
  iframe.src = agentUrl;
  iframe.allow = "microphone";
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.border = "none";
  iframe.style.backgroundColor = "transparent";
  iframe.title = "Voice Assistant";

  // When expanding/collapsing, the UI inside the iframe will send a message
  window.addEventListener("message", function (event) {
    if (event.origin !== hostUrl) return;

    if (event.data === "voiceclaw-expand") {
      container.style.width = "380px";
      container.style.height = "600px";
      container.style.borderRadius = "20px";
      // Adjust positioning for larger size on mobile
      if (window.innerWidth < 400) {
        container.style.bottom = "0";
        container.style.right = "0";
        container.style.width = "100%";
        container.style.height = "100%";
        container.style.borderRadius = "0";
      }
    } else if (event.data === "voiceclaw-collapse") {
      container.style.width = "80px";
      container.style.height = "80px";
      container.style.borderRadius = "40px";
      container.style.bottom = "20px";
      container.style.right = "20px";
    }
  });

  container.appendChild(iframe);
  document.body.appendChild(container);
})();
