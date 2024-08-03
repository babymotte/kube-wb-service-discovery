#!/bin/bash

NAME=$(jq <package.json '.name' -r)
VERSION=$(jq <package.json '.version' -r)
docker build -t "babymotte/$NAME:$VERSION" -t "babymotte/$NAME:latest" --push .
helm upgrade "$NAME" ./chart
# git push
