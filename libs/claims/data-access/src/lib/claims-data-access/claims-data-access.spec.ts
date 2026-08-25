import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClaimsDataAccess } from './claims-data-access';

describe('ClaimsDataAccess', () => {
  let component: ClaimsDataAccess;
  let fixture: ComponentFixture<ClaimsDataAccess>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClaimsDataAccess],
    }).compileComponents();

    fixture = TestBed.createComponent(ClaimsDataAccess);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
