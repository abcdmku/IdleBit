import type { VisibleState } from "../../game";
import type { Dispatch } from "../uiActions";
import { getBuilderGroups } from "./builderHelpers";
import { CustomSystemBuilder } from "./CustomSystemBuilder";
import type { UiRackData } from "./types";

interface BuilderScreenProps {
  rack: UiRackData;
  resources: VisibleState["resources"];
  systemDispatch: Dispatch;
}

export function BuilderScreen({
  rack,
  resources,
  systemDispatch,
}: BuilderScreenProps) {
  const hasCustomBuilder = getBuilderGroups(rack.customBuilder).length > 0;

  return (
    <section className="builder-screen" aria-label="System builder">
      <div className="builder-screen-body">
        <div className="builder-new">
          {hasCustomBuilder && (
            <CustomSystemBuilder
              builder={rack.customBuilder}
              resources={resources}
              dispatch={systemDispatch}
            />
          )}
        </div>
      </div>
    </section>
  );
}
