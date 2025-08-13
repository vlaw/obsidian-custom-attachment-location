#!/usr/bin/env bash

npm run build

VAULT='/Volumes/Source/code/gitee.com/my_vaults/trading'
DOT_DIRS=('.obsidian' '.obsidian.ipad')

for dir in "${DOT_DIRS[@]}"; do
  echo "Copying to ${VAULT}/${dir}"
  cp -r ./dist/build/* "${VAULT}/${dir}/plugins/obsidian-custom-attachment-location/"
done
