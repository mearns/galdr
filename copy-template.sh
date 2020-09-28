#!/usr/bin/env bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

rsync -r \
    --exclude=".git/" \
    --exclude="dist/" \
    --exclude="node_modules/" \
    --exclude="out/" \
    --exclude=".nyc_output/" \
    --exclude="coverage/" \
    --exclude="copy-template.sh" \
    "$DIR/" "$1"
