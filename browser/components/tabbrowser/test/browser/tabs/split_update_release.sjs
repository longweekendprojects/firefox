function handleRequest(request, response) {
  let tag = new URLSearchParams(request.queryString).get("tag");
  response.setHeader("Content-Type", "application/json", false);
  response.write(
    JSON.stringify({
      tag_name: tag,
      name: "Nightly Split test (" + tag + ")",
      html_url: "https://example.com/release",
      assets: [
        { name: "Other.zip", browser_download_url: "https://example.com/o" },
        {
          name: "Nightly-Split-macOS-arm64.dmg",
          browser_download_url: "https://example.com/n.dmg",
        },
      ],
    })
  );
}
