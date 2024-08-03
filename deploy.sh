#!/bin/bash

NAME=$(jq <package.json '.name' -r)
VERSION=$(jq <package.json '.version' -r)
docker build -t "babymotte/$NAME:$VERSION" -t "babymotte/$NAME:latest" --push .
helm uninstall "$NAME" ./chart && helm install "$NAME" ./chart
# git push
