/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { DoorstepSystem } from './doorstep-system.js';
import { KolamSystem } from './kolam-system.js';
import { addStartCard } from './start-card.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(DoorstepSystem);
  world.registerSystem(KolamSystem);
  addStartCard(world);
});
