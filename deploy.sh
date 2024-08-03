#!/bin/bash

NAME=$(jq <package.json '.name' -r)
VERSION=$(jq <package.json '.version' -r)
git tag "v$VERSION" || exit 1
docker build -t "babymotte/$NAME:$VERSION" -t "babymotte/$NAME:latest" --push . || exit 1
helm upgrade "$NAME" ./chart
git push && git push --tags
