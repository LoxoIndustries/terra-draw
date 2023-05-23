import {
	TerraDrawMouseEvent,
	TerraDrawAdapterStyling,
	TerraDrawKeyboardEvent,
	HexColor,
} from "../../common";
import { Polygon } from "geojson";
import { selfIntersects } from "../../geometry/boolean/self-intersects";
import { TerraDrawBaseDrawMode } from "../base.mode";
import { PixelDistanceBehavior } from "../pixel-distance.behavior";
import { ClickBoundingBoxBehavior } from "../click-bounding-box.behavior";
import { BehaviorConfig } from "../base.behavior";
import { createPolygon } from "../../util/geoms";
import { SnappingBehavior } from "../snapping.behavior";
import { coordinatesIdentical } from "../../geometry/coordinates-identical";
import { ClosingPointsBehavior } from "./behaviors/closing-points.behavior";
import { getDefaultStyling } from "../../util/styling";
import { GeoJSONStoreFeatures } from "../../store/store";

type TerraDrawPolygonModeKeyEvents = {
	cancel?: KeyboardEvent["key"] | null;
	finish?: KeyboardEvent["key"] | null;
};

type PolygonStyling = {
	fillColor: HexColor;
	outlineColor: HexColor;
	outlineWidth: number;
	fillOpacity: number;
	closingPointWidth: number;
	closingPointColor: HexColor;
	closingPointOutlineWidth: number;
	closingPointOutlineColor: HexColor;
};

export class TerraDrawPolygonMode extends TerraDrawBaseDrawMode<PolygonStyling> {
	mode = "polygon";

	private currentCoordinate = 0;
	private currentId: string | undefined;
	private allowSelfIntersections: boolean;
	private keyEvents: TerraDrawPolygonModeKeyEvents;
	private snappingEnabled: boolean;

	// Behaviors
	private snapping!: SnappingBehavior;
	private pixelDistance!: PixelDistanceBehavior;
	private closingPoints!: ClosingPointsBehavior;

	private mouseMove = false;

	constructor(options?: {
		allowSelfIntersections?: boolean;
		snapping?: boolean;
		pointerDistance?: number;
		styles?: Partial<PolygonStyling>;
		keyEvents?: TerraDrawPolygonModeKeyEvents | null;
	}) {
		super(options);

		this.snappingEnabled =
			options && options.snapping !== undefined ? options.snapping : false;

		this.allowSelfIntersections =
			options && options.allowSelfIntersections !== undefined
				? options.allowSelfIntersections
				: true;

		// We want to have some defaults, but also allow key bindings
		// to be explicitly turned off
		if (options?.keyEvents === null) {
			this.keyEvents = { cancel: null, finish: null };
		} else {
			const defaultKeyEvents = { cancel: "Escape", finish: "Enter" };
			this.keyEvents =
				options && options.keyEvents
					? { ...defaultKeyEvents, ...options.keyEvents }
					: defaultKeyEvents;
		}
	}

	private close() {
		if (!this.currentId) {
			return;
		}

		const currentPolygonCoordinates = this.store.getGeometryCopy<Polygon>(
			this.currentId
		).coordinates[0];

		// We don't want to allow closing if there is not enough
		// coordinates. We have extra because we insert them on mouse
		// move
		if (currentPolygonCoordinates.length < 5) {
			return;
		}

		this.store.updateGeometry([
			{
				id: this.currentId,
				geometry: {
					type: "Polygon",
					coordinates: [
						[
							...currentPolygonCoordinates.slice(0, -2),
							currentPolygonCoordinates[0],
						],
					],
				},
			},
		]);

		const finishedId = this.currentId;

		this.currentCoordinate = 0;
		this.currentId = undefined;
		this.closingPoints.delete();

		// Go back to started state
		if (this.state === "drawing") {
			this.setStarted();
		}

		this.onFinish(finishedId);
	}

	/** @internal */
	registerBehaviors(config: BehaviorConfig) {
		this.pixelDistance = new PixelDistanceBehavior(config);
		this.snapping = new SnappingBehavior(
			config,
			this.pixelDistance,
			new ClickBoundingBoxBehavior(config)
		);
		this.closingPoints = new ClosingPointsBehavior(config, this.pixelDistance);
	}

	/** @internal */
	start() {
		this.setStarted();
		this.setCursor("crosshair");
	}

	/** @internal */
	stop() {
		this.cleanUp();
		this.setStopped();
		this.setCursor("unset");
	}

	/** @internal */
	onMouseMove(event: TerraDrawMouseEvent) {
		this.mouseMove = true;
		this.setCursor("crosshair");

		if (!this.currentId || this.currentCoordinate === 0) {
			return;
		}

		const closestCoord = this.snappingEnabled
			? this.snapping.getSnappableCoordinate(event, this.currentId)
			: undefined;

		const currentPolygonCoordinates = this.store.getGeometryCopy<Polygon>(
			this.currentId
		).coordinates[0];

		if (closestCoord) {
			event.lng = closestCoord[0];
			event.lat = closestCoord[1];
		}

		let updatedCoordinates;

		if (this.currentCoordinate === 1) {
			// We must add a very small epsilon value so that Mapbox GL
			// renders the polygon - There might be a cleaner solution?
			const epsilon = 1 / Math.pow(10, this.coordinatePrecision - 1);
			const offset = Math.max(0.000001, epsilon);

			updatedCoordinates = [
				currentPolygonCoordinates[0],
				[event.lng, event.lat],
				[event.lng, event.lat - offset],
				currentPolygonCoordinates[0],
			];
		} else if (this.currentCoordinate === 2) {
			updatedCoordinates = [
				currentPolygonCoordinates[0],
				currentPolygonCoordinates[1],
				[event.lng, event.lat],
				currentPolygonCoordinates[0],
			];
		} else {
			const { isClosing, isPreviousClosing } =
				this.closingPoints.isClosingPoint(event);

			if (isPreviousClosing || isClosing) {
				this.setCursor("pointer");
				updatedCoordinates = [
					...currentPolygonCoordinates.slice(0, -2),
					currentPolygonCoordinates[0],
					currentPolygonCoordinates[0],
				];
			} else {
				updatedCoordinates = [
					...currentPolygonCoordinates.slice(0, -2),
					[event.lng, event.lat],
					currentPolygonCoordinates[0],
				];
			}
		}

		this.store.updateGeometry([
			{
				id: this.currentId,
				geometry: {
					type: "Polygon",
					coordinates: [updatedCoordinates],
				},
			},
		]);

		// if (this.closingPoints.ids.length) {
		// 	this.closingPoints.update(updatedCoordinates);
		// }
	}

	/** @internal */
	onClick(event: TerraDrawMouseEvent) {
		// We want pointer devices (mobile/tablet) to have
		// similar behaviour to mouse based devices so we
		// trigger a mousemove event before every click
		// if one has not been trigged to emulate this
		if (this.currentCoordinate > 0 && !this.mouseMove) {
			this.onMouseMove(event);
		}
		this.mouseMove = false;

		const closestCoord =
			this.currentId && this.snappingEnabled
				? this.snapping.getSnappableCoordinate(event, this.currentId)
				: undefined;

		if (this.currentCoordinate === 0) {
			if (closestCoord) {
				event.lng = closestCoord[0];
				event.lat = closestCoord[1];
			}

			const [newId] = this.store.create([
				{
					geometry: {
						type: "Polygon",
						coordinates: [
							[
								[event.lng, event.lat],
								[event.lng, event.lat],
								[event.lng, event.lat],
								[event.lng, event.lat],
							],
						],
					},
					properties: { mode: this.mode },
				},
			]);
			this.currentId = newId;
			this.currentCoordinate++;

			// Ensure the state is updated to reflect drawing has started
			this.setDrawing();
		} else if (this.currentCoordinate === 1 && this.currentId) {
			if (closestCoord) {
				event.lng = closestCoord[0];
				event.lat = closestCoord[1];
			}

			const currentPolygonGeometry = this.store.getGeometryCopy<Polygon>(
				this.currentId
			);

			const previousCoordinate = currentPolygonGeometry.coordinates[0][0];
			const isIdentical = coordinatesIdentical(
				[event.lng, event.lat],
				previousCoordinate
			);

			if (isIdentical) {
				return;
			}

			this.store.updateGeometry([
				{
					id: this.currentId,
					geometry: {
						type: "Polygon",
						coordinates: [
							[
								currentPolygonGeometry.coordinates[0][0],
								[event.lng, event.lat],
								[event.lng, event.lat],
								currentPolygonGeometry.coordinates[0][0],
							],
						],
					},
				},
			]);

			this.currentCoordinate++;
		} else if (this.currentCoordinate === 2 && this.currentId) {
			if (closestCoord) {
				event.lng = closestCoord[0];
				event.lat = closestCoord[1];
			}

			const currentPolygonCoordinates = this.store.getGeometryCopy<Polygon>(
				this.currentId
			).coordinates[0];

			const previousCoordinate = currentPolygonCoordinates[1];
			const isIdentical = coordinatesIdentical(
				[event.lng, event.lat],
				previousCoordinate
			);

			if (isIdentical) {
				return;
			}

			if (this.currentCoordinate === 2) {
				this.closingPoints.create(currentPolygonCoordinates, "polygon");
			}

			this.store.updateGeometry([
				{
					id: this.currentId,
					geometry: {
						type: "Polygon",
						coordinates: [
							[
								currentPolygonCoordinates[0],
								currentPolygonCoordinates[1],
								[event.lng, event.lat],
								[event.lng, event.lat],
								currentPolygonCoordinates[0],
							],
						],
					},
				},
			]);

			this.currentCoordinate++;
		} else if (this.currentId) {
			const currentPolygonCoordinates = this.store.getGeometryCopy<Polygon>(
				this.currentId
			).coordinates[0];

			const { isClosing, isPreviousClosing } =
				this.closingPoints.isClosingPoint(event);

			if (isPreviousClosing || isClosing) {
				this.close();
			} else {
				if (closestCoord) {
					event.lng = closestCoord[0];
					event.lat = closestCoord[1];
				}

				const previousCoordinate =
					currentPolygonCoordinates[this.currentCoordinate - 1];
				const isIdentical = coordinatesIdentical(
					[event.lng, event.lat],
					previousCoordinate
				);

				if (isIdentical) {
					return;
				}

				const updatedPolygon = createPolygon([
					[
						...currentPolygonCoordinates.slice(0, -1),
						[event.lng, event.lat], // New point that onMouseMove can manipulate
						currentPolygonCoordinates[0],
					],
				]);

				if (this.currentCoordinate > 2 && !this.allowSelfIntersections) {
					const hasSelfIntersections = selfIntersects(updatedPolygon);

					if (hasSelfIntersections) {
						// Don't update the geometry!
						return;
					}
				}

				// If not close to the final point, keep adding points
				this.store.updateGeometry([
					{ id: this.currentId, geometry: updatedPolygon.geometry },
				]);
				this.currentCoordinate++;

				// Update closing points straight away
				if (this.closingPoints.ids.length) {
					this.closingPoints.update(updatedPolygon.geometry.coordinates[0]);
				}
			}
		}
	}

	/** @internal */
	onKeyUp(event: TerraDrawKeyboardEvent) {
		if (event.key === this.keyEvents.cancel) {
			this.cleanUp();
		} else if (event.key === this.keyEvents.finish) {
			this.close();
		}
	}

	/** @internal */
	onKeyDown() {}

	/** @internal */
	onDragStart() {
		// We want to allow the default drag
		// cursor to exist
		this.setCursor("unset");
	}

	/** @internal */
	onDrag() {}

	/** @internal */
	onDragEnd() {
		// Set it back to crosshair
		this.setCursor("crosshair");
	}

	/** @internal */
	cleanUp() {
		try {
			if (this.currentId) {
				this.store.delete([this.currentId]);
			}
			if (this.closingPoints.ids.length) {
				this.closingPoints.delete();
			}
		} catch (error) {}
		this.currentId = undefined;
		this.currentCoordinate = 0;
		if (this.state === "drawing") {
			this.setStarted();
		}
	}

	/** @internal */
	styleFeature(feature: GeoJSONStoreFeatures): TerraDrawAdapterStyling {
		const styles = { ...getDefaultStyling() };

		if (feature.properties.mode === this.mode) {
			if (feature.geometry.type === "Polygon") {
				styles.polygonFillColor =
					this.styles.fillColor || styles.polygonFillColor;
				styles.polygonOutlineColor =
					this.styles.outlineColor || styles.polygonOutlineColor;
				styles.polygonOutlineWidth =
					this.styles.outlineWidth || styles.polygonOutlineWidth;
				styles.polygonFillColor =
					this.styles.fillColor || styles.polygonFillColor;
				styles.polygonFillOpacity =
					this.styles.fillOpacity || styles.polygonFillOpacity;
				styles.zIndex = 10;
				return styles;
			} else if (feature.geometry.type === "Point") {
				styles.pointWidth = this.styles.closingPointWidth || styles.pointWidth;
				styles.pointColor = this.styles.closingPointColor || styles.pointColor;
				styles.pointOutlineColor =
					this.styles.closingPointOutlineColor || "#ffffff";
				styles.pointOutlineWidth = this.styles.closingPointOutlineWidth || 2;
				styles.zIndex = 30;
				return styles;
			}
		}

		return styles;
	}
}
