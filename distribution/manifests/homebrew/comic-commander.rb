# Comic Commander – Homebrew cask (distribution/README.md).
#
# NOT for homebrew/homebrew-cask yet: the official tap only accepts apps that pass Gatekeeper (code-signed and
# notarized); v1.0.1 is unsigned. Use it in an own tap (github.com/krocon/homebrew-tap → Casks/comic-commander.rb)
# only after Marc agrees – users would then have to allow the unsigned app themselves (right-click → Open).
# Submit to the official tap once a signed + notarized release exists, after `brew audit --new --cask`.
cask "comic-commander" do
  version "1.0.1"
  sha256 "943aa9c06d385423ea9e9884429d215041ca82f3f953cdff06177b2f28d17bdc"

  url "https://github.com/krocon/comic-commander-tauri/releases/download/v#{version}/Comic.Commander_#{version}_universal.dmg",
      verified: "github.com/krocon/comic-commander-tauri/"
  name "Comic Commander"
  desc "Comic browser with cover thumbnails and a built-in reader"
  homepage "https://krocon.de/products/comiccommander/"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :monterey"

  app "Comic Commander.app"

  # Tauri stores config/cache under the bundle identifier – verify the paths on a Mac before submitting.
  zap trash: [
    "~/Library/Application Support/io.github.krocon.comiccommander",
    "~/Library/Caches/io.github.krocon.comiccommander",
    "~/Library/Saved Application State/io.github.krocon.comiccommander.savedState",
    "~/Library/WebKit/io.github.krocon.comiccommander",
  ]
end
