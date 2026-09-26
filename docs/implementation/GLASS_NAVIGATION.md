# Glass navigation acceptance

Replaces the overflowing desktop and mobile page lists with five grouped destinations. Diary, Obligations and Approvals are pinned by default; users can keep up to three shortcuts, stored per account and organization in their browser. Search covers existing pages and loaded projects (Ctrl/Cmd+K). Settings, project creation, invitations and sign-out remain accessible through the profile menu. The bell opens pending approvals.

Desktop uses a glass header and sliding active-group indicator. Mobile uses the same destinations in a bottom bar, compact header and bottom-sheet navigation. Native dialogs provide focus containment and Escape dismissal; motion respects reduced-motion preferences. Existing view URLs and project controls remain in use. Communications Service and transport policies are unchanged.

Validation: typecheck and production build passed; all 585 unit tests passed. The isolated `tests/ui/navigation.html` fixture was exercised at desktop, 390px and 320px widths. Verified Work to Flows navigation, Diary search, Ctrl+K/Escape, pin replacement and persistence after reload. Visual review caught and corrected backdrop-filter creating a fixed-position containing block on mobile. No external actions are performed by the fixture.

Search does not yet index contacts or individual flow records. Project selection opens the selected project; it does not silently change project filters inside independent panels such as Diary.

## Ambient capture navigation addition — PR #56

The current navigation registry has seven workspace groups. **Work → Unresolved Items** adds the `captures` destination (`?view=captures`), bringing the daily destination count to fifteen; tenant administration remains separate. This queue spans the signed-in user's projects and does not inherit the selected-project filter. It is distinct from the existing Quick capture/scratch view.

The earlier 585-test and browser-fixture results above describe the navigation release, not the new capture panel. Capture/navigation unit checks pass; visual verification of this panel remains an open gate. See the [feature guide](../AMBIENT_WORK_CAPTURE_IMPLEMENTATION.md).
