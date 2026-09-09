export type RequestStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type RequestPriority = 'LOW' | 'STANDARD' | 'URGENT';

export interface RequestRecord {
  id: string;
  title: string;
  description: string;
  priority: RequestPriority;
  status: RequestStatus;
  resolution_note?: string;
}

export interface UpdateRequestStatusDto {
  status: RequestStatus;
  resolution_note?: string;
}

export class RequestsService {
  private readonly requests: RequestRecord[] = [
    {
      id: 'req-1',
      title: 'Laptop Request',
      description: 'Employee needs a replacement work laptop for onboarding.',
      priority: 'URGENT',
      status: 'PENDING',
    },
    {
      id: 'req-2',
      title: 'VPN Access Request',
      description: 'Employee needs temporary access to the finance VPN for travel.',
      priority: 'STANDARD',
      status: 'IN_PROGRESS',
    },
    {
      id: 'req-3',
      title: 'Desk Setup Request',
      description: 'Employee requests an ergonomic desk setup and additional monitor.',
      priority: 'LOW',
      status: 'COMPLETED',
      resolution_note: 'Resolved successfully.',
    },
  ];

  findById(id: string): RequestRecord | undefined {
    return this.requests.find((request) => request.id === id);
  }

  getAll(): RequestRecord[] {
    return this.requests;
  }

  updateStatus(id: string, dto: UpdateRequestStatusDto): RequestRecord {
    const request = this.findById(id);

    if (!request) {
      throw new Error('REQUEST_NOT_FOUND');
    }

    const currentStatus = request.status;
    const nextStatus = dto.status;

    if (currentStatus === 'COMPLETED' && nextStatus !== 'COMPLETED') {
      throw new Error('INVALID_TRANSITION');
    }

    if (currentStatus === 'CANCELLED' && nextStatus !== 'CANCELLED') {
      throw new Error('INVALID_TRANSITION');
    }

    if (currentStatus === 'PENDING' && nextStatus === 'CANCELLED') {
      request.status = nextStatus;
      return request;
    }

    if (currentStatus === 'PENDING' && nextStatus === 'COMPLETED') {
      throw new Error('INVALID_TRANSITION');
    }

    if (currentStatus === 'PENDING' && nextStatus === 'IN_PROGRESS') {
      request.status = nextStatus;
      if (dto.resolution_note) {
        request.resolution_note = dto.resolution_note;
      }
      return request;
    }

    if (currentStatus === 'IN_PROGRESS' && nextStatus === 'COMPLETED') {
      if (!dto.resolution_note || dto.resolution_note.trim() === '') {
        throw new Error('RESOLUTION_NOTE_REQUIRED');
      }
      request.status = nextStatus;
      request.resolution_note = dto.resolution_note;
      return request;
    }

    if (currentStatus === 'IN_PROGRESS' && nextStatus === 'IN_PROGRESS') {
      if (dto.resolution_note) {
        request.resolution_note = dto.resolution_note;
      }
      return request;
    }

    throw new Error('INVALID_TRANSITION');
  }
}




