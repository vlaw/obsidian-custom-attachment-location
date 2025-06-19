#!/usr/bin/env bash

VAULT='/Volumes/Source/code/gitee.com/my_vaults/trading'

npm run build

cp -r ./dist/build/* "$VAULT/.obsidian/plugins/obsidian-custom-attachment-location/"
