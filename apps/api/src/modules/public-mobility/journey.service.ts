import { Injectable } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import {
  JourneySearchResponseSchema,
  type JourneyOption,
  type JourneySearchRequest,
  type JourneySearchResponse,
} from '@quivo/shared';

const WALKING_METERS_PER_MINUTE = 75;
const TRANSIT_METERS_PER_MINUTE = 300;
const MAX_TRANSFER_WALKING_METERS = 180;
const MAX_JOURNEY_CANDIDATES = 50;

interface DirectCandidateRow {
  routeId: string;
  lineId: string;
  lineCode: string;
  lineName: string;
  direction: string;
  originWalkMeters: number;
  destinationWalkMeters: number;
  transportMeters: number;
  originProgress: number;
  destinationProgress: number;
}

interface TransferCandidateRow {
  firstRouteId: string;
  firstLineId: string;
  firstLineCode: string;
  firstLineName: string;
  firstDirection: string;
  secondRouteId: string;
  secondLineId: string;
  secondLineCode: string;
  secondLineName: string;
  secondDirection: string;
  originWalkMeters: number;
  transferWalkMeters: number;
  destinationWalkMeters: number;
  firstTransportMeters: number;
  secondTransportMeters: number;
  originProgress: number;
  firstTransferProgress: number;
  secondTransferProgress: number;
  destinationProgress: number;
}

interface TwoTransferCandidateRow {
  firstRouteId: string;
  firstLineId: string;
  firstLineCode: string;
  firstLineName: string;
  firstDirection: string;
  secondRouteId: string;
  secondLineId: string;
  secondLineCode: string;
  secondLineName: string;
  secondDirection: string;
  thirdRouteId: string;
  thirdLineId: string;
  thirdLineCode: string;
  thirdLineName: string;
  thirdDirection: string;
  originWalkMeters: number;
  firstTransferWalkMeters: number;
  secondTransferWalkMeters: number;
  destinationWalkMeters: number;
  firstTransportMeters: number;
  secondTransportMeters: number;
  thirdTransportMeters: number;
  originProgress: number;
  firstTransferProgress: number;
  secondBoardingProgress: number;
  secondAlightingProgress: number;
  thirdTransferProgress: number;
  destinationProgress: number;
}

@Injectable()
export class JourneyService {
  /** Encuentra alternativas directas y con hasta dos transbordos entre rutas publicadas. */
  async buscarViajes(input: JourneySearchRequest): Promise<JourneySearchResponse> {
    const [originLng, originLat] = input.origin.coordinates;
    const [destinationLng, destinationLat] = input.destination.coordinates;
    // La omisión mantiene compatibles las apps antiguas mientras el cliente
    // migra al selector explícito de ciudad.
    const cityId = input.cityId ?? 'cochabamba';
    const [directCandidates, transferCandidates, twoTransferCandidates] = await withTenantContext(
      { rol: 'admin_quivo', sindicatoId: null },
      async (tx) => {
        const direct = await tx.$queryRaw<DirectCandidateRow[]>`
        WITH points AS (
          SELECT
            ST_SetSRID(ST_MakePoint(${originLng}, ${originLat}), 4326)::geography AS origin,
            ST_SetSRID(ST_MakePoint(${destinationLng}, ${destinationLat}), 4326)::geography AS destination
        ), candidates AS (
          SELECT
            r.id AS "routeId", l.id AS "lineId", l.codigo AS "lineCode", l.nombre AS "lineName", r.sentido AS direction,
            ST_Distance(r.geometria, points.origin) AS "originWalkMeters",
            ST_Distance(r.geometria, points.destination) AS "destinationWalkMeters",
            ST_LineLocatePoint(r.geometria::geometry, points.origin::geometry) AS "originProgress",
            ST_LineLocatePoint(r.geometria::geometry, points.destination::geometry) AS "destinationProgress",
            ST_Length(ST_LineSubstring(
              r.geometria::geometry,
              ST_LineLocatePoint(r.geometria::geometry, points.origin::geometry),
              ST_LineLocatePoint(r.geometria::geometry, points.destination::geometry)
            )::geography) AS "transportMeters"
          FROM rutas r
          JOIN lineas l ON l.id = r."lineaId"
          CROSS JOIN points
          WHERE l."publicStatus" = 'publicado'
            AND l."cityId" = ${cityId}
            AND r."publicStatus" = 'publicado'
            AND r.estado = 'activo'
            AND ST_DWithin(r.geometria, points.origin, ${input.maxWalkingMeters})
            AND ST_DWithin(r.geometria, points.destination, ${input.maxWalkingMeters})
        )
        SELECT * FROM candidates
        WHERE "originProgress" < "destinationProgress"
        ORDER BY ("originWalkMeters" + "destinationWalkMeters"), "transportMeters"
        LIMIT ${MAX_JOURNEY_CANDIDATES}
      `;
        const transfers = await tx.$queryRaw<TransferCandidateRow[]>`
        WITH points AS (
          SELECT
            ST_SetSRID(ST_MakePoint(${originLng}, ${originLat}), 4326)::geography AS origin,
            ST_SetSRID(ST_MakePoint(${destinationLng}, ${destinationLat}), 4326)::geography AS destination
        ), published_routes AS (
          SELECT r.id AS "routeId", l.id AS "lineId", l.codigo AS "lineCode", l.nombre AS "lineName", r.sentido AS direction, r.geometria AS geometry
          FROM rutas r JOIN lineas l ON l.id = r."lineaId"
          WHERE l."publicStatus" = 'publicado' AND l."cityId" = ${cityId}
            AND r."publicStatus" = 'publicado' AND r.estado = 'activo'
        ), origin_routes AS (
          SELECT r.*, ST_Distance(r.geometry, points.origin) AS "originWalkMeters",
            ST_LineLocatePoint(r.geometry::geometry, points.origin::geometry) AS "originProgress"
          FROM published_routes r CROSS JOIN points
          WHERE ST_DWithin(r.geometry, points.origin, ${input.maxWalkingMeters})
        ), destination_routes AS (
          SELECT r.*, ST_Distance(r.geometry, points.destination) AS "destinationWalkMeters",
            ST_LineLocatePoint(r.geometry::geometry, points.destination::geometry) AS "destinationProgress"
          FROM published_routes r CROSS JOIN points
          WHERE ST_DWithin(r.geometry, points.destination, ${input.maxWalkingMeters})
        ), candidates AS (
          SELECT
            first_route."routeId" AS "firstRouteId", first_route."lineId" AS "firstLineId", first_route."lineCode" AS "firstLineCode", first_route."lineName" AS "firstLineName", first_route.direction AS "firstDirection",
            second_route."routeId" AS "secondRouteId", second_route."lineId" AS "secondLineId", second_route."lineCode" AS "secondLineCode", second_route."lineName" AS "secondLineName", second_route.direction AS "secondDirection",
            first_route."originWalkMeters", second_route."destinationWalkMeters",
            ST_Distance(first_route.geometry, second_route.geometry) AS "transferWalkMeters",
            first_route."originProgress", second_route."destinationProgress",
            ST_LineLocatePoint(first_route.geometry::geometry, ST_ClosestPoint(first_route.geometry::geometry, second_route.geometry::geometry)) AS "firstTransferProgress",
            ST_LineLocatePoint(second_route.geometry::geometry, ST_ClosestPoint(second_route.geometry::geometry, first_route.geometry::geometry)) AS "secondTransferProgress",
            ST_Length(ST_LineSubstring(first_route.geometry::geometry, first_route."originProgress", ST_LineLocatePoint(first_route.geometry::geometry, ST_ClosestPoint(first_route.geometry::geometry, second_route.geometry::geometry)))::geography) AS "firstTransportMeters",
            ST_Length(ST_LineSubstring(second_route.geometry::geometry, ST_LineLocatePoint(second_route.geometry::geometry, ST_ClosestPoint(second_route.geometry::geometry, first_route.geometry::geometry)), second_route."destinationProgress")::geography) AS "secondTransportMeters"
          FROM origin_routes first_route
          JOIN destination_routes second_route ON first_route."routeId" <> second_route."routeId"
            AND ST_DWithin(first_route.geometry, second_route.geometry, ${MAX_TRANSFER_WALKING_METERS})
        )
        SELECT * FROM candidates
        WHERE "originProgress" < "firstTransferProgress"
          AND "secondTransferProgress" < "destinationProgress"
        ORDER BY ("originWalkMeters" + "transferWalkMeters" + "destinationWalkMeters"), ("firstTransportMeters" + "secondTransportMeters")
        LIMIT ${MAX_JOURNEY_CANDIDATES}
      `;
        const twoTransfers = await tx.$queryRaw<TwoTransferCandidateRow[]>`
        WITH points AS (
          SELECT
            ST_SetSRID(ST_MakePoint(${originLng}, ${originLat}), 4326)::geography AS origin,
            ST_SetSRID(ST_MakePoint(${destinationLng}, ${destinationLat}), 4326)::geography AS destination
        ), published_routes AS (
          SELECT r.id AS "routeId", l.id AS "lineId", l.codigo AS "lineCode", l.nombre AS "lineName", r.sentido AS direction, r.geometria AS geometry
          FROM rutas r JOIN lineas l ON l.id = r."lineaId"
          WHERE l."publicStatus" = 'publicado' AND l."cityId" = ${cityId}
            AND r."publicStatus" = 'publicado' AND r.estado = 'activo'
        ), origin_routes AS (
          SELECT r.*, ST_Distance(r.geometry, points.origin) AS "originWalkMeters",
            ST_LineLocatePoint(r.geometry::geometry, points.origin::geometry) AS "originProgress"
          FROM published_routes r CROSS JOIN points
          WHERE ST_DWithin(r.geometry, points.origin, ${input.maxWalkingMeters})
        ), destination_routes AS (
          SELECT r.*, ST_Distance(r.geometry, points.destination) AS "destinationWalkMeters",
            ST_LineLocatePoint(r.geometry::geometry, points.destination::geometry) AS "destinationProgress"
          FROM published_routes r CROSS JOIN points
          WHERE ST_DWithin(r.geometry, points.destination, ${input.maxWalkingMeters})
        ), candidates AS (
          SELECT
            first_route."routeId" AS "firstRouteId", first_route."lineId" AS "firstLineId", first_route."lineCode" AS "firstLineCode", first_route."lineName" AS "firstLineName", first_route.direction AS "firstDirection",
            second_route."routeId" AS "secondRouteId", second_route."lineId" AS "secondLineId", second_route."lineCode" AS "secondLineCode", second_route."lineName" AS "secondLineName", second_route.direction AS "secondDirection",
            third_route."routeId" AS "thirdRouteId", third_route."lineId" AS "thirdLineId", third_route."lineCode" AS "thirdLineCode", third_route."lineName" AS "thirdLineName", third_route.direction AS "thirdDirection",
            first_route."originWalkMeters", third_route."destinationWalkMeters",
            ST_Distance(first_route.geometry, second_route.geometry) AS "firstTransferWalkMeters",
            ST_Distance(second_route.geometry, third_route.geometry) AS "secondTransferWalkMeters",
            first_route."originProgress",
            third_route."destinationProgress",
            ST_LineLocatePoint(first_route.geometry::geometry, ST_ClosestPoint(first_route.geometry::geometry, second_route.geometry::geometry)) AS "firstTransferProgress",
            ST_LineLocatePoint(second_route.geometry::geometry, ST_ClosestPoint(second_route.geometry::geometry, first_route.geometry::geometry)) AS "secondBoardingProgress",
            ST_LineLocatePoint(second_route.geometry::geometry, ST_ClosestPoint(second_route.geometry::geometry, third_route.geometry::geometry)) AS "secondAlightingProgress",
            ST_LineLocatePoint(third_route.geometry::geometry, ST_ClosestPoint(third_route.geometry::geometry, second_route.geometry::geometry)) AS "thirdTransferProgress",
            ST_Length(ST_LineSubstring(
              first_route.geometry::geometry,
              first_route."originProgress",
              ST_LineLocatePoint(first_route.geometry::geometry, ST_ClosestPoint(first_route.geometry::geometry, second_route.geometry::geometry))
            )::geography) AS "firstTransportMeters",
            ST_Length(ST_LineSubstring(
              second_route.geometry::geometry,
              ST_LineLocatePoint(second_route.geometry::geometry, ST_ClosestPoint(second_route.geometry::geometry, first_route.geometry::geometry)),
              ST_LineLocatePoint(second_route.geometry::geometry, ST_ClosestPoint(second_route.geometry::geometry, third_route.geometry::geometry))
            )::geography) AS "secondTransportMeters",
            ST_Length(ST_LineSubstring(
              third_route.geometry::geometry,
              ST_LineLocatePoint(third_route.geometry::geometry, ST_ClosestPoint(third_route.geometry::geometry, second_route.geometry::geometry)),
              third_route."destinationProgress"
            )::geography) AS "thirdTransportMeters"
          FROM origin_routes first_route
          JOIN published_routes second_route ON first_route."routeId" <> second_route."routeId"
            AND ST_DWithin(first_route.geometry, second_route.geometry, ${MAX_TRANSFER_WALKING_METERS})
          JOIN destination_routes third_route ON first_route."routeId" <> third_route."routeId"
            AND second_route."routeId" <> third_route."routeId"
            AND ST_DWithin(second_route.geometry, third_route.geometry, ${MAX_TRANSFER_WALKING_METERS})
        )
        SELECT * FROM candidates
        WHERE "originProgress" < "firstTransferProgress"
          AND "secondBoardingProgress" < "secondAlightingProgress"
          AND "thirdTransferProgress" < "destinationProgress"
        ORDER BY (
          "originWalkMeters" + "firstTransferWalkMeters" + "secondTransferWalkMeters" + "destinationWalkMeters"
        ), ("firstTransportMeters" + "secondTransportMeters" + "thirdTransportMeters")
        LIMIT ${MAX_JOURNEY_CANDIDATES}
      `;
        return [direct, transfers, twoTransfers] as const;
      },
    );
    const options = [
      ...directCandidates.map(toDirectJourney),
      ...transferCandidates.map(toTransferJourney),
      ...twoTransferCandidates.map(toTwoTransferJourney),
    ]
      .sort((a, b) => a.score - b.score)
      .slice(0, MAX_JOURNEY_CANDIDATES);
    return JourneySearchResponseSchema.parse({ options, recommendedIds: pickRecommendedIds(options) });
  }
}

/**
 * Destaca hasta tres opciones por eje distinto (más rápida, menos transbordos, menos
 * caminata) para que la UI pueda mostrar "recomendadas" sin descartar las demás. Si un
 * eje ya está cubierto por una opción elegida, no se repite.
 */
export function pickRecommendedIds(options: JourneyOption[]): string[] {
  if (options.length === 0) return [];
  const recommended: string[] = [];
  const addIfNew = (option: JourneyOption | undefined) => {
    if (option && !recommended.includes(option.id)) recommended.push(option.id);
  };

  addIfNew(options[0]);

  const fewestTransfers = [...options].sort(
    (a, b) => a.transfers - b.transfers || a.score - b.score,
  )[0];
  addIfNew(fewestTransfers);

  const leastWalking = [...options].sort(
    (a, b) => a.walkingDistanceMeters - b.walkingDistanceMeters || a.score - b.score,
  )[0];
  addIfNew(leastWalking);

  return recommended.slice(0, 3);
}

function toTransferJourney(candidate: TransferCandidateRow): JourneyOption {
  const originWalk = Math.round(candidate.originWalkMeters);
  const transferWalk = Math.round(candidate.transferWalkMeters);
  const destinationWalk = Math.round(candidate.destinationWalkMeters);
  const firstTransport = Math.round(candidate.firstTransportMeters);
  const secondTransport = Math.round(candidate.secondTransportMeters);
  const walkDuration = Math.ceil(
    (originWalk + transferWalk + destinationWalk) / WALKING_METERS_PER_MINUTE,
  );
  const firstDuration = Math.ceil(firstTransport / TRANSIT_METERS_PER_MINUTE);
  const secondDuration = Math.ceil(secondTransport / TRANSIT_METERS_PER_MINUTE);
  const estimatedDurationMinutes = walkDuration + firstDuration + secondDuration + 4;
  return {
    id: `transfer:${candidate.firstRouteId}:${candidate.secondRouteId}`,
    score: estimatedDurationMinutes + (originWalk + transferWalk + destinationWalk) / 100 + 4,
    estimatedDurationMinutes,
    walkingDistanceMeters: originWalk + transferWalk + destinationWalk,
    transportDistanceMeters: firstTransport + secondTransport,
    transfers: 1,
    segments: [
      {
        type: 'walk',
        distanceMeters: originWalk,
        durationMinutes: Math.ceil(originWalk / WALKING_METERS_PER_MINUTE),
      },
      {
        type: 'transit',
        distanceMeters: firstTransport,
        durationMinutes: firstDuration,
        line: {
          id: candidate.firstLineId,
          code: candidate.firstLineCode,
          name: candidate.firstLineName,
        },
        routeId: candidate.firstRouteId,
        direction: candidate.firstDirection,
      },
      {
        type: 'transfer',
        distanceMeters: transferWalk,
        durationMinutes: Math.ceil(transferWalk / WALKING_METERS_PER_MINUTE) + 4,
      },
      {
        type: 'transit',
        distanceMeters: secondTransport,
        durationMinutes: secondDuration,
        line: {
          id: candidate.secondLineId,
          code: candidate.secondLineCode,
          name: candidate.secondLineName,
        },
        routeId: candidate.secondRouteId,
        direction: candidate.secondDirection,
      },
      {
        type: 'walk',
        distanceMeters: destinationWalk,
        durationMinutes: Math.ceil(destinationWalk / WALKING_METERS_PER_MINUTE),
      },
    ],
  };
}

function toTwoTransferJourney(candidate: TwoTransferCandidateRow): JourneyOption {
  const originWalk = Math.round(candidate.originWalkMeters);
  const firstTransferWalk = Math.round(candidate.firstTransferWalkMeters);
  const secondTransferWalk = Math.round(candidate.secondTransferWalkMeters);
  const destinationWalk = Math.round(candidate.destinationWalkMeters);
  const firstTransport = Math.round(candidate.firstTransportMeters);
  const secondTransport = Math.round(candidate.secondTransportMeters);
  const thirdTransport = Math.round(candidate.thirdTransportMeters);
  const totalWalking = originWalk + firstTransferWalk + secondTransferWalk + destinationWalk;
  const walkDuration = Math.ceil(totalWalking / WALKING_METERS_PER_MINUTE);
  const firstDuration = Math.ceil(firstTransport / TRANSIT_METERS_PER_MINUTE);
  const secondDuration = Math.ceil(secondTransport / TRANSIT_METERS_PER_MINUTE);
  const thirdDuration = Math.ceil(thirdTransport / TRANSIT_METERS_PER_MINUTE);
  const estimatedDurationMinutes =
    walkDuration + firstDuration + secondDuration + thirdDuration + 8;
  return {
    id: `transfer2:${candidate.firstRouteId}:${candidate.secondRouteId}:${candidate.thirdRouteId}`,
    score: estimatedDurationMinutes + totalWalking / 100 + 8,
    estimatedDurationMinutes,
    walkingDistanceMeters: totalWalking,
    transportDistanceMeters: firstTransport + secondTransport + thirdTransport,
    transfers: 2,
    segments: [
      {
        type: 'walk',
        distanceMeters: originWalk,
        durationMinutes: Math.ceil(originWalk / WALKING_METERS_PER_MINUTE),
      },
      {
        type: 'transit',
        distanceMeters: firstTransport,
        durationMinutes: firstDuration,
        line: {
          id: candidate.firstLineId,
          code: candidate.firstLineCode,
          name: candidate.firstLineName,
        },
        routeId: candidate.firstRouteId,
        direction: candidate.firstDirection,
      },
      {
        type: 'transfer',
        distanceMeters: firstTransferWalk,
        durationMinutes: Math.ceil(firstTransferWalk / WALKING_METERS_PER_MINUTE) + 4,
      },
      {
        type: 'transit',
        distanceMeters: secondTransport,
        durationMinutes: secondDuration,
        line: {
          id: candidate.secondLineId,
          code: candidate.secondLineCode,
          name: candidate.secondLineName,
        },
        routeId: candidate.secondRouteId,
        direction: candidate.secondDirection,
      },
      {
        type: 'transfer',
        distanceMeters: secondTransferWalk,
        durationMinutes: Math.ceil(secondTransferWalk / WALKING_METERS_PER_MINUTE) + 4,
      },
      {
        type: 'transit',
        distanceMeters: thirdTransport,
        durationMinutes: thirdDuration,
        line: {
          id: candidate.thirdLineId,
          code: candidate.thirdLineCode,
          name: candidate.thirdLineName,
        },
        routeId: candidate.thirdRouteId,
        direction: candidate.thirdDirection,
      },
      {
        type: 'walk',
        distanceMeters: destinationWalk,
        durationMinutes: Math.ceil(destinationWalk / WALKING_METERS_PER_MINUTE),
      },
    ],
  };
}

function toDirectJourney(candidate: DirectCandidateRow): JourneyOption {
  const originWalk = Math.round(candidate.originWalkMeters);
  const destinationWalk = Math.round(candidate.destinationWalkMeters);
  const transport = Math.round(candidate.transportMeters);
  const walkDuration = Math.ceil((originWalk + destinationWalk) / WALKING_METERS_PER_MINUTE);
  const transitDuration = Math.ceil(transport / TRANSIT_METERS_PER_MINUTE);
  const estimatedDurationMinutes = walkDuration + transitDuration;
  return {
    id: `direct:${candidate.routeId}`,
    score: estimatedDurationMinutes + (originWalk + destinationWalk) / 100,
    estimatedDurationMinutes,
    walkingDistanceMeters: originWalk + destinationWalk,
    transportDistanceMeters: transport,
    transfers: 0,
    segments: [
      {
        type: 'walk',
        distanceMeters: originWalk,
        durationMinutes: Math.ceil(originWalk / WALKING_METERS_PER_MINUTE),
      },
      {
        type: 'transit',
        distanceMeters: transport,
        durationMinutes: transitDuration,
        line: { id: candidate.lineId, code: candidate.lineCode, name: candidate.lineName },
        routeId: candidate.routeId,
        direction: candidate.direction,
      },
      {
        type: 'walk',
        distanceMeters: destinationWalk,
        durationMinutes: Math.ceil(destinationWalk / WALKING_METERS_PER_MINUTE),
      },
    ],
  };
}
