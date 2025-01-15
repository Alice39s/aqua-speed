#!/usr/bin/env bash
set -e

VERSION=$(jq -r .version <package.json)
echo "Building version: $VERSION"

mkdir -p dist/{out,logs}
BUILD_PATH="$(pwd)/dist"

PLATFORMS=(
    "linux-x64:linux-x64-baseline"
    "linux-arm64:linux-arm64"
    "windows-x64:windows-x64-baseline"
    "darwin-x64:darwin-x64"
    "darwin-arm64:darwin-arm64"
)

echo "Installing dependencies..."
bun install

for platform in "${PLATFORMS[@]}"; do
    IFS=":" read -r version target <<<"$platform"

    echo "Building for $version (target: bun-$target)..."

    BINARY_NAME="aqua-speed-${version}_v${VERSION}"
    if [[ "$version" == *"windows"* ]]; then
        BINARY_NAME="${BINARY_NAME}.exe"
    fi

    if [[ "$version" == *"linux"* ]]; then
        ARCHIVE_NAME="aqua-speed-${version}_v${VERSION}.tar.xz"
    else
        ARCHIVE_NAME="aqua-speed-${version}_v${VERSION}.zip"
    fi

    bun build --compile --sourcemap --minify --bytecode \
        --target="bun-$target" \
        ./src/cli.ts \
        --outfile "$BUILD_PATH/out/$BINARY_NAME"

    pushd "$BUILD_PATH/out" >/dev/null
    sha1sum "$BINARY_NAME" >checksum.txt

    if [[ "$version" == *"linux"* ]]; then
        # tar -c -I 'xz -5 -T0' -f "$ARCHIVE_NAME" "$BINARY_NAME" checksum.txt
        tar -cJf "$ARCHIVE_NAME" "$BINARY_NAME" checksum.txt
    else
        zip -j "$ARCHIVE_NAME" "$BINARY_NAME" checksum.txt
    fi

    cp checksum.txt "${BINARY_NAME}.checksum.txt"

    rm -f "$BINARY_NAME" checksum.txt
    popd >/dev/null

    echo "Completed build for $version"
done

echo "Consolidating checksums..."
cat dist/out/*.checksum.txt >dist/out/checksums.txt
rm dist/out/*.checksum.txt

echo "Build complete! Artifacts are in dist/out/"
ls -la dist/out/
